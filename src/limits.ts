import { LIMITS } from "./config";
import { hashDomain, utcDay } from "./domain";

export interface CapStore {
  get(key: string): Promise<number>;
  add(key: string, amount: number): Promise<void>;
}

export function kvCapStore(kv: KVNamespace): CapStore {
  return {
    async get(key) {
      const value = await kv.get(key);
      const parsed = value === null ? 0 : Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    },
    async add(key, amount) {
      const current = Number((await kv.get(key)) ?? "0");
      const next = (Number.isFinite(current) ? current : 0) + amount;
      // Two days covers the UTC boundary. Counters are not page contents.
      await kv.put(key, String(next), { expirationTtl: 60 * 60 * 48 });
    },
  };
}

export interface CapDecision {
  ok: true;
  domainHash: string;
  pages: number;
}

export async function checkPageCaps(
  store: CapStore,
  input: { hostname: string; pages: number; globalLimit: number; now: Date },
): Promise<CapDecision | { ok: false; message: string }> {
  if (!Number.isInteger(input.pages) || input.pages < 1) {
    return { ok: false, message: "Page count is invalid" };
  }
  const domainHash = await hashDomain(input.hostname);
  const day = utcDay(input.now);
  const domainUsed = await store.get(`domain:${day}:${domainHash}`);
  const globalUsed = await store.get(`global:${day}`);
  if (domainUsed + input.pages > LIMITS.pagesPerDomainPerDay) {
    return { ok: false, message: "Daily page cap for this domain is reached" };
  }
  if (globalUsed + input.pages > input.globalLimit) {
    return { ok: false, message: "Daily page cap is reached" };
  }
  return { ok: true, domainHash, pages: input.pages };
}

export async function commitPages(
  store: CapStore,
  domainHash: string,
  pages: number,
  now: Date,
): Promise<void> {
  const day = utcDay(now);
  await store.add(`domain:${day}:${domainHash}`, pages);
  await store.add(`global:${day}`, pages);
}

export interface CallLimiter {
  limit(key: string): Promise<boolean>;
}

export function bindingLimiter(limiter: RateLimit): CallLimiter {
  return {
    async limit(key) {
      const result = await limiter.limit({ key });
      return result.success;
    },
  };
}

/** Payer address from an unverified x402 payload, used only as a limiter key. */
export function payerHint(token: string | null): string | undefined {
  if (!token) return undefined;
  try {
    const payload = JSON.parse(decodeBase64(token)) as {
      payload?: { authorization?: { from?: unknown } };
    };
    const from = payload.payload?.authorization?.from;
    if (typeof from === "string" && /^0x[a-fA-F0-9]{40}$/.test(from)) return from.toLowerCase();
  } catch {
    return undefined;
  }
  return undefined;
}

export function decodeBase64(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded);
}

export function clientKey(request: Request, paymentToken: string | null): string {
  return payerHint(paymentToken) ?? request.headers.get("cf-connecting-ip") ?? "unknown";
}
