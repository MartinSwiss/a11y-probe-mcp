import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { decodeBase64 } from "../limits";
import { payToAddress, resourceServerFor } from "./facilitator";

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

  const resource = {
    url: input.resourceUrl,
    description: input.description,
    mimeType: "application/json",
  };

  const challenge = async (error?: string): Promise<ChargeResult> => {
    const paymentRequired = await server.createPaymentRequiredResponse(
      requirements,
      resource,
      error,
      input.extensions,
    );
    const body = error ? { ...paymentRequired, error } : paymentRequired;
    const headers = new Headers({
      "content-type": "application/json",
      "cache-control": "no-store",
      "payment-required": btoa(JSON.stringify(body)),
    });
    return { state: "challenge", status: 402, body, headers };
  };

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
    const verified = await server.verifyPayment(payload, matching);
    if (!verified.isValid) return challenge(verified.invalidReason ?? "INVALID_PAYMENT");
  } catch {
    return challenge("INVALID_PAYMENT");
  }

  return {
    state: "verified",
    settle: async () => {
      try {
        const settled = await server.settlePayment(payload, matching);
        if (!settled.success) {
          return {
            ok: false,
            status: 402,
            body: { error: { code: "settlement", message: settled.errorReason ?? "SETTLEMENT_FAILED" } },
          };
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
