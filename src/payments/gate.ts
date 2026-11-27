import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { decodeBase64 } from "../limits";
import { payToAddress, resourceServerFor } from "./facilitator";
import {
  readStripeSettings,
  recordStripeUsdcPayment,
  sptAllowed,
  stripeSptChallenge,
  stripeSptVerifier,
  usdToCents,
  withStripeX402Accepts,
  type StripeSptVerifier,
} from "./stripe-machine";

export interface SettledPayment {
  transaction: string;
  network: string;
  payer: string;
}

export type ChargeResult =
  | { state: "challenge"; status: 402; body: PaymentRequired; headers: Headers }
  | { state: "verified"; settle: () => Promise<SettleResult> }
  | { state: "error"; status: number; body: unknown };

export type SettleResult =
  | { ok: true; settlement: SettledPayment }
  | { ok: false; status: number; body: unknown };

/**
 * Verify payment, but do not settle. The caller settles only after the scan succeeds.
 * A missing or rejected payment returns 402 and does not settle.
 */
export async function charge(
  env: Env,
  input: {
    price: number;
    resourceUrl: string;
    description: string;
    paymentToken: string | null;
    extensions: Record<string, unknown>;
    sptCredential?: string | null;
    sptVerifier?: StripeSptVerifier;
    stripeFetch?: typeof fetch;
    now?: Date;
  },
): Promise<ChargeResult> {
  const payTo = payToAddress(env.PAY_TO);
  if (!payTo) {
    return { state: "error", status: 503, body: { error: { code: "payee", message: "PAY_TO is not configured" } } };
  }

  let server;
  try {
    server = await resourceServerFor(env);
  } catch {
    return {
      state: "error",
      status: 503,
      body: { error: { code: "facilitator", message: "Payment facilitator is not available" } },
    };
  }

  let requirements: PaymentRequirements[];
  try {
    requirements = await server.buildPaymentRequirements({
      scheme: "exact",
      payTo,
      price: input.price,
      network: env.X402_NETWORK,
      maxTimeoutSeconds: 300,
    });
  } catch {
    return {
      state: "error",
      status: 503,
      body: { error: { code: "facilitator", message: "Payment requirements could not be built" } },
    };
  }

  const stripe = readStripeSettings(env);
  if (stripe.enabled && stripe.depositAddress) {
    try {
      const extra = await server.buildPaymentRequirements({
        scheme: "exact",
        payTo: stripe.depositAddress,
        price: input.price,
        network: env.X402_NETWORK,
        maxTimeoutSeconds: 300,
      });
      requirements = withStripeX402Accepts(requirements, extra, stripe.depositAddress);
    } catch {
      // The CDP option still stands when the Stripe requirement cannot be built.
    }
  }

  const resource = {
    url: input.resourceUrl,
    description: input.description,
    mimeType: "application/json",
  };
  const transport = {
    method: "POST",
    adapter: {
      getPath: () => {
        try {
          return new URL(input.resourceUrl).pathname;
        } catch {
          return "/";
        }
      },
    },
  };
  // bazaarResourceServerExtension.enrichDeclaration sets method from this context.
  // The declaration itself omits method until that hook runs.
  const extensions = server.enrichExtensions(input.extensions, transport);

  const challenge = async (error?: string): Promise<ChargeResult> => {
    const paymentRequired = await server.createPaymentRequiredResponse(
      requirements,
      resource,
      error,
      extensions,
      transport,
    );
    const body = error ? { ...paymentRequired, error } : paymentRequired;
    const headers = new Headers({
      "content-type": "application/json",
      "cache-control": "no-store",
      "payment-required": btoa(JSON.stringify(body)),
    });
    if (stripe.enabled && stripe.secretKey && stripe.profileId && sptAllowed(input.price)) {
      const spt = await stripeSptChallenge({
        secretKey: stripe.secretKey,
        profileId: stripe.profileId,
        priceUsd: input.price,
        resourceUrl: input.resourceUrl,
        description: input.description,
        now: input.now ?? new Date(),
      });
      headers.set("www-authenticate", spt.header);
    }
    return { state: "challenge", status: 402, body, headers };
  };

  if (!input.paymentToken && stripe.enabled && input.sptCredential && sptAllowed(input.price) && stripe.secretKey) {
    const verifier = input.sptVerifier ?? stripeSptVerifier(stripe.secretKey, input.stripeFetch);
    const verified = await verifier.verify({
      credential: input.sptCredential,
      amountCents: usdToCents(input.price),
      resourceUrl: input.resourceUrl,
    });
    if (!verified.ok) return challenge("INVALID_PAYMENT");
    return {
      state: "verified",
      settle: async () => ({
        ok: true,
        settlement: { transaction: verified.paymentIntentId, network: "stripe", payer: "" },
      }),
    };
  }

  if (!input.paymentToken) return challenge("PAYMENT_REQUIRED");

  let payload: PaymentPayload;
  try {
    payload = JSON.parse(decodeBase64(input.paymentToken)) as PaymentPayload;
  } catch {
    return challenge("INVALID_PAYMENT");
  }

  const matching = server.findMatchingRequirements(requirements, payload);
  if (!matching) return challenge("INVALID_PAYMENT");

  try {
    const verified = await server.verifyPayment(payload, matching, extensions, transport);
    if (!verified.isValid) return challenge(verified.invalidReason ?? "INVALID_PAYMENT");
  } catch {
    return challenge("INVALID_PAYMENT");
  }

  return {
    state: "verified",
    settle: async () => {
      try {
        const settled = await server.settlePayment(payload, matching, extensions, transport);
        if (!settled.success) {
          return {
            ok: false,
            status: 402,
            body: { error: { code: "settlement", message: settled.errorReason ?? "SETTLEMENT_FAILED" } },
          };
        }
        if (stripe.enabled && stripe.secretKey && stripe.depositAddress && matching.payTo.toLowerCase() === stripe.depositAddress.toLowerCase()) {
          await recordStripeUsdcPayment({
            secretKey: stripe.secretKey,
            amountAtomic: String(matching.amount),
            transactionHash: settled.transaction,
            ...(input.stripeFetch ? { fetchImpl: input.stripeFetch } : {}),
          });
        }
        return {
          ok: true,
          settlement: {
            transaction: settled.transaction,
            network: String(settled.network),
            payer: settled.payer ?? "",
          },
        };
      } catch {
        return {
          ok: false,
          status: 402,
          body: { error: { code: "settlement", message: "SETTLEMENT_FAILED" } },
        };
      }
    },
  };
}
