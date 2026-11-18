import { describe, expect, it } from "vitest";
import { hashDomain } from "../src/domain";
import { checkPageCaps, type CapStore } from "../src/limits";

function memoryStore(seed: Record<string, number> = {}): CapStore {
  const values = new Map(Object.entries(seed));
  return {
    async get(key) {
      return values.get(key) ?? 0;
    },
    async add(key, amount) {
      values.set(key, (values.get(key) ?? 0) + amount);
    },
  };
}

describe("daily caps", () => {
  const now = new Date("2026-11-18T12:00:00.000Z");

  it("rejects a domain that would pass 50 pages before any payment", async () => {
    const domainHash = await hashDomain("example.com");
    const store = memoryStore({ [`domain:2026-11-18:${domainHash}`]: 50 });
    const decision = await checkPageCaps(store, { hostname: "example.com", pages: 1, globalLimit: 20, now });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.message).toMatch(/domain/);
  });

  it("rejects when the global cap would be exceeded", async () => {
    const store = memoryStore({ "global:2026-11-18": 18 });
    const decision = await checkPageCaps(store, { hostname: "example.com", pages: 3, globalLimit: 20, now });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.message).toMatch(/Daily page cap is reached/);
  });

  it("hashes the domain and does not store the hostname", async () => {
    const store = memoryStore();
    const decision = await checkPageCaps(store, { hostname: "Example.COM", pages: 1, globalLimit: 20, now });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.domainHash).toBe(await hashDomain("example.com"));
    expect(decision.domainHash).not.toContain("example");
  });
});
