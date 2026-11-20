import { describe, expect, it } from "vitest";
import { isNonPublicAddress, resolveWithDoh } from "../../src/scan/ssrf";

describe("DoH inside workerd", () => {
  it("resolves a public hostname with the runtime fetch", async () => {
    const addresses = await resolveWithDoh("example.com");
    expect(addresses.length).toBeGreaterThan(0);
    for (const address of addresses) {
      expect(isNonPublicAddress(address)).toBe(false);
    }
  });
});
