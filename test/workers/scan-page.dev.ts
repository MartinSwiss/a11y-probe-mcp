import { unstable_dev, type Unstable_DevWorker } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PAY_TO = "0x4c1265a4c0e7128aa71513080988dd609f3fdc32";

describe("scanDependencies fetch in wrangler workerd", () => {
  let probe: Unstable_DevWorker;

  beforeAll(async () => {
    probe = await unstable_dev("test/workers/fetch-probe.ts", {
      config: "test/workers/probe.wrangler.jsonc",
      local: true,
      envFiles: ["test/workers/dev-vars.empty"],
      logLevel: "error",
      experimental: {
        disableExperimentalWarning: true,
        disableDevRegistry: true,
        forceLocal: true,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await probe?.stop();
  });

  it("rejects a detached global fetch and still reads robots.txt through scanDependencies", async () => {
    const detached = await probe.fetch("https://probe.example/detached");
    const detachedBody = (await detached.json()) as { threw: boolean; message?: string; status?: number };
    expect(detachedBody.threw, JSON.stringify(detachedBody)).toBe(true);
    expect(detachedBody.message).toMatch(/Illegal invocation/);

    const scanned = await probe.fetch("https://probe.example/scan-deps");
    const scannedBody = (await scanned.json()) as { status: number };
    expect(scanned.status).toBe(200);
    expect(scannedBody.status).toBeGreaterThanOrEqual(200);
    expect(scannedBody.status).toBeLessThan(500);
  }, 60_000);
});

describe("unpaid scan_page in wrangler workerd", () => {
  let worker: Unstable_DevWorker;

  beforeAll(async () => {
    worker = await unstable_dev("src/index.ts", {
      config: "wrangler.jsonc",
      local: true,
      envFiles: ["test/workers/dev-vars.empty"],
      logLevel: "error",
      experimental: {
        disableExperimentalWarning: true,
        disableDevRegistry: true,
        forceLocal: true,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await worker?.stop();
  });

  it("reaches 402 naming the network and PAY_TO", async () => {
    const response = await worker.fetch("https://a11y-probe.example/api/v1/scan/page", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.10",
      },
      body: JSON.stringify({ url: "https://example.com/", authorized: true }),
    });
    const text = await response.text();
    expect(response.status, text).toBe(402);
    const header = response.headers.get("payment-required") ?? "";
    const decoded = header ? Buffer.from(header, "base64").toString("utf8") : "";
    const named = `${text}\n${decoded}`;
    expect(named).toContain("eip155:84532");
    expect(named.toLowerCase()).toContain(PAY_TO);
    const body = JSON.parse(text) as { accepts?: Array<{ network?: string; payTo?: string }> };
    expect(body.accepts?.[0]?.network).toBe("eip155:84532");
    expect(body.accepts?.[0]?.payTo?.toLowerCase()).toBe(PAY_TO);

    const empty = await worker.fetch("https://a11y-probe.example/api/v1/scan/page", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.11" },
      body: "",
    });
    const emptyText = await empty.text();
    expect(empty.status, emptyText).toBe(402);
    expect(empty.headers.get("payment-required")).toBeTruthy();

    const llms = await worker.fetch("https://a11y-probe.example/llms.txt");
    const llmsText = await llms.text();
    expect(llms.status, llmsText).toBe(200);
    expect(llms.headers.get("content-type") ?? "").toMatch(/text\/plain/);
    expect(llmsText).toContain("# A11y Probe");
    expect(llmsText).toContain("https://a11y.aiagentpay.cloud/mcp");
  }, 60_000);
});
