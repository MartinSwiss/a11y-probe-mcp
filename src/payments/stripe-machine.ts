import type { PaymentRequirements } from "@x402/core/types";
import { payToAddress } from "./facilitator";

/**
 * Stripe Machine Payments is optional. Anything other than the exact string
 * "true" leaves the CDP x402 flow unchanged.
 *
 * Docs:
 * - https://docs.stripe.com/payments/machine
 * - https://docs.stripe.com/payments/machine/x402
 * - https://docs.stripe.com/payments/machine/mpp
 * - https://mpp.dev/protocol/challenges
 * - https://mpp.dev/payment-methods/stripe
 */
export const SPT_MINIMUM_USD = 0.5;
const STRIPE_VERSION = "2026-05-27.preview";

export interface StripeSettings {
  enabled: boolean;
  secretKey?: string;
  depositAddress?: `0x${string}`;
  profileId?: string;
}

type StripeBindings = {
  STRIPE_MACHINE_PAYMENTS?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_DEPOSIT_ADDRESS?: string;
  STRIPE_PROFILE_ID?: string;
};

export function readStripeSettings(env: Env): StripeSettings {
  const extra = env as Env & StripeBindings;
  const enabled = extra.STRIPE_MACHINE_PAYMENTS === "true";
  const deposit = extra.STRIPE_DEPOSIT_ADDRESS ? payToAddress(extra.STRIPE_DEPOSIT_ADDRESS) : undefined;
  return {
    enabled,
    ...(extra.STRIPE_SECRET_KEY ? { secretKey: extra.STRIPE_SECRET_KEY } : {}),
    ...(deposit ? { depositAddress: deposit } : {}),
    ...(extra.STRIPE_PROFILE_ID ? { profileId: extra.STRIPE_PROFILE_ID } : {}),
  };
}

/** Card SPTs are 0.50 USD minimum. Stablecoin x402 on Base is a separate rail. */
export function sptAllowed(priceUsd: number): boolean {
  return Math.round(priceUsd * 100) >= Math.round(SPT_MINIMUM_USD * 100);
}

export function usdToCents(priceUsd: number): string {
  return String(Math.round(priceUsd * 100));
}

/**
 * Append a Base USDC exact-scheme requirement paid to the Stripe deposit
 * address. The CDP requirement stays first.
 */
export function withStripeX402Accepts(
  current: PaymentRequirements[],
  stripe: PaymentRequirements[],
  depositAddress: string,
): PaymentRequirements[] {
  const extra = stripe.filter((item) => item.payTo.toLowerCase() === depositAddress.toLowerCase());
  const already = new Set(current.map((item) => `${item.payTo.toLowerCase()}|${item.network}|${item.amount}`));
  return [...current, ...extra.filter((item) => !already.has(`${item.payTo.toLowerCase()}|${item.network}|${item.amount}`))];
}

export interface SptChallenge {
  header: string;
  id: string;
  request: Record<string, unknown>;
}

/**
 * MPP Challenge for a Stripe SPT charge. The Credential comes back in
 * Payment-Authorization. Challenge id binding follows
 * https://mpp.dev/protocol/challenges
 */
export async function stripeSptChallenge(input: {
  secretKey: string;
  profileId: string;
  priceUsd: number;
  resourceUrl: string;
  description: string;
  now: Date;
}): Promise<SptChallenge> {
  const request = {
    amount: usdToCents(input.priceUsd),
    currency: "usd",
    decimals: 2,
    description: input.description,
    methodDetails: {
      networkId: input.profileId,
      paymentMethodTypes: ["card", "link"],
    },
  };
  const encodedRequest = base64url(jcs(request));
  const expires = new Date(input.now.getTime() + 5 * 60 * 1000).toISOString();
  const realm = new URL(input.resourceUrl).host;
  const method = "stripe";
  const intent = "charge";
  const headerName = "Payment-Authorization";
  const id = await hmacId(
    input.secretKey,
    [realm, method, intent, encodedRequest, expires, "", headerName, ""].join("|"),
  );
  const header = [
    "Payment",
    `id="${id}"`,
    `realm="${realm}"`,
    `method="${method}"`,
    `intent="${intent}"`,
    `request="${encodedRequest}"`,
    `expires="${expires}"`,
    `header="${headerName}"`,
    `description="${input.description.replace(/"/g, "")}"`,
  ].join(" ");
  return { header, id, request };
}

export function readSptCredential(request: Request): string | null {
  const dedicated = request.headers.get("payment-authorization");
  if (dedicated) return dedicated;
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("payment ")) return authorization.slice("payment ".length).trim();
  return null;
}

export interface SptVerification {
  ok: true;
  paymentIntentId: string;
}

export interface StripeSptVerifier {
  verify(input: { credential: string; amountCents: string; resourceUrl: string }): Promise<SptVerification | { ok: false; reason: string }>;
}

/**
 * Confirm an SPT by creating a PaymentIntent. The full MPP credential
 * envelope (challenge-id echo, receipt) is still TODO; this accepts the
 * documented payload `{ spt: "spt_..." }`.
 */
export function stripeSptVerifier(secretKey: string, fetchImpl: typeof fetch = fetch): StripeSptVerifier {
  return {
    async verify(input) {
      const spt = sptId(input.credential);
      if (!spt) return { ok: false, reason: "spt_credential_rejected" };
      const body = new URLSearchParams({
        amount: input.amountCents,
        currency: "usd",
        confirm: "true",
        payment_method: spt,
      });
      let response: Response;
      try {
        response = await fetchImpl("https://api.stripe.com/v1/payment_intents", {
          method: "POST",
          headers: {
            authorization: `Bearer ${secretKey}`,
            "content-type": "application/x-www-form-urlencoded",
            "stripe-version": STRIPE_VERSION,
            "idempotency-key": spt,
          },
          body,
        });
      } catch {
        return { ok: false, reason: "stripe_verification_failed" };
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { ok: false, reason: "stripe_verification_failed" };
      }
      const payload = (await response.json()) as { id?: string };
      if (!payload.id) return { ok: false, reason: "stripe_verification_failed" };
      return { ok: true, paymentIntentId: payload.id };
    },
  };
}

/**
 * Record a settled Base USDC transfer as a PaymentIntent. Stripe's x402
 * guide uses transaction_verification mode and skips sub-cent amounts.
 * https://docs.stripe.com/payments/machine/x402
 */
export async function recordStripeUsdcPayment(input: {
  secretKey: string;
  amountAtomic: string;
  transactionHash: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; id: string } | { ok: false }> {
  const amountInCents = Math.round(Number(input.amountAtomic) / 10_000);
  if (!Number.isFinite(amountInCents) || amountInCents < 1) return { ok: false };
  const body = new URLSearchParams({
    amount: String(amountInCents),
    currency: "usd",
    confirm: "true",
    "payment_method_data[type]": "crypto",
    "allowed_payment_method_types[0]": "crypto",
    "payment_method_options[crypto][mode]": "transaction_verification",
    "payment_method_options[crypto][transaction_verification_options][network]": "base",
    "payment_method_options[crypto][transaction_verification_options][transaction_hash]": input.transactionHash,
  });
  const response = await (input.fetchImpl ?? fetch)("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_VERSION,
      "idempotency-key": input.transactionHash,
    },
    body,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false };
  }
  const payload = (await response.json()) as { id?: string };
  return payload.id ? { ok: true, id: payload.id } : { ok: false };
}

function sptId(credential: string): string | undefined {
  const direct = credential.trim();
  if (direct.startsWith("spt_")) return direct;
  const decoded = decodeCredential(direct);
  if (!decoded) return undefined;
  try {
    const payload = JSON.parse(decoded) as { spt?: unknown };
    return typeof payload.spt === "string" && payload.spt.startsWith("spt_") ? payload.spt : undefined;
  } catch {
    return undefined;
  }
}

function decodeCredential(value: string): string | undefined {
  if (value.startsWith("{")) return value;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
    return atob(padded);
  } catch {
    return undefined;
  }
}

function jcs(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => jcs(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${jcs(item)}`).join(",")}}`;
}

function base64url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacId(secret: string, material: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(material)));
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return base64url(binary);
}
