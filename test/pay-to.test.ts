import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { PayToError, assertPayTo } from "../src/payments/facilitator";

const RECEIVING = "0x4C1265A4c0e7128aa71513080988dD609f3fDC32";

describe("PAY_TO", () => {
  it("accepts the checksummed receiving address", () => {
    expect(assertPayTo(RECEIVING)).toBe(RECEIVING);
    expect(assertPayTo(RECEIVING.toLowerCase())).toBe(RECEIVING);
  });

  it("rejects a malformed address before the worker handles the request", async () => {
    expect(() => assertPayTo("0x123")).toThrow(PayToError);
    expect(() => assertPayTo("")).toThrow(PayToError);
    expect(() => assertPayTo("not-an-address")).toThrow(PayToError);
    expect(() => assertPayTo("0x4C1265A4c0e7128aa71513080988dD609f3fDC33")).toThrow(PayToError);

    const app = createApp();
    if (!app.fetch) throw new Error("missing fetch");
    const response = await app.fetch(
      new Request("https://a11y-probe.example/api/v1/pricing") as never,
      { PAY_TO: "0x123" } as unknown as Env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("payee");
  });
});