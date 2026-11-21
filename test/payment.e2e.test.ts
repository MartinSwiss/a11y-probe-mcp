import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import { withX402Client } from "agents/x402";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { hashDomain } from "../src/domain";
import { resetResourceServers } from "../src/payments/facilitator";
import { PageTimeoutError } from "../src/scan/errors";
import type { ScanDeps } from "../src/scan/scan";
import { publicDns, scriptedFetch } from "./helpers";

const PAY_TO = "0x2222222222222222222222222222222222222222";
const PAYER = "0x1111111111111111111111111111111111111111";

async function call(app: ExportedHandler<Env>, request: Request, env: Env): Promise<Response> {
  if (!app.fetch) throw new Error("missing fetch");
  return app.fetch(request as never, env, {} as ExecutionContext);
}

interface Recorded {
  path: string;
  body?: { paymentPayload?: { resource?: { url?: string }; extensions?: { bazaar?: unknown } } };
}

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void | Promise<void>,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    await handler(req, res, Buffer.concat(chunks).toString("utf8"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function startFacilitator(): Promise<{ url: string; calls: Recorded[]; close: () => Promise<void> }> {
  const calls: Recorded[] = [];
  const seen = new Set<string>();
  return listen((req, res, raw) => {
    calls.push({ path: req.url ?? "", body: raw ? (JSON.parse(raw) as Recorded["body"]) : undefined });
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.url === "/supported") {
      send(200, {
        kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
        extensions: ["bazaar"],
        signers: {},
      });
      return;
    }
    const body = raw ? (JSON.parse(raw) as { paymentPayload?: { payload?: unknown } }) : {};
    const id = JSON.stringify(body.paymentPayload?.payload ?? body.paymentPayload ?? raw);
    if (req.url === "/verify") {
      if (seen.has(id)) {
        send(200, { isValid: false, invalidReason: "replayed", payer: PAYER });
        return;
      }
      seen.add(id);
      send(200, { isValid: true, payer: PAYER });
      return;
    }
    if (req.url === "/settle") {
      send(200, { success: true, transaction: "0xtesthash", network: "eip155:84532", payer: PAYER });
      return;
    }
    send(404, { error: "not found" });
  }).then((server) => ({ ...server, calls }));
}

function memoryKv(seed: Record<string, string> = {}): KVNamespace {
  const values = new Map(Object.entries(seed));
  return {
    get: async (key: string) => values.get(key) ?? null,
    put: async (key: string, value: string) => {
      values.set(key, value);
    },
  } as KVNamespace;
}

function makeEnv(facilitator: string, kv: KVNamespace, limit: (key: string) => boolean = () => true): Env {
  return {
    INFO_URL: "https://a11y-probe.example/",
    X402_NETWORK: "eip155:84532",
    FACILITATOR_URL: facilitator,
    GLOBAL_DAILY_PAGE_CAP: "20",
    PAY_TO,
    CDP_API_KEY_ID: "",
    CDP_API_KEY_SECRET: "",
    CAPS: kv,
    RATE_LIMITER: { limit: async ({ key }: { key: string }) => ({ success: limit(key) }) },
    BROWSER: {} as BrowserRun,
  } as unknown as Env;
}

const home = "<!doctype html><html><body><img src='x.png'></body></html>";

function pageFetch() {
  return scriptedFetch({
    "https://example.com/robots.txt": { status: 404 },
    "https://example.com/": { body: home, headers: { "content-type": "text/html" } },
    "https://blocked.example/robots.txt": {
      body: "User-agent: *\nDisallow: /\n",
      headers: { "content-type": "text/plain" },
    },
  });
}

function inspectOk(): ScanDeps["inspect"] {
  return async () => ({
    raw: {
      violations: [
        {
          id: "image-alt",
          impact: "critical",
          tags: ["wcag2a"],
          help: "Images must have alternative text",
          helpUrl: "https://example.com/rules/image-alt",
          nodes: [{ target: ["img"], html: "<img>" }],
        },
      ],
      incomplete: [],
      passes: [{}],
      testEngine: { version: "4.14.1" },
    },
    links: [],
  });
}

async function paymentClient() {
  const account = privateKeyToAccount(generatePrivateKey());
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });
  return { account, client };
}

describe("x402 payments", () => {
  let facilitator: Awaited<ReturnType<typeof startFacilitator>>;

  beforeEach(async () => {
    resetResourceServers();
    facilitator = await startFacilitator();
  });

  afterEach(async () => {
    await facilitator.close();
  });

  it("returns 402 with a Bazaar extension when a scan is unpaid", async () => {
    const fetchImpl = pageFetch();
    const app = createApp({
      fetchImpl,
      resolveAddresses: publicDns(),
      inspect: inspectOk(),
      now: () => new Date("2026-11-18T12:00:00.000Z"),
    });
    const response = await call(
      app,
      new Request("https://a11y-probe.example/api/v1/scan/page", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.8" },
        body: JSON.stringify({ url: "https://example.com/", authorized: true }),
      }),
      makeEnv(facilitator.url, memoryKv()),
    );
    expect(response.status).toBe(402);
    const body = (await response.json()) as PaymentRequired & { extensions?: { bazaar?: { info?: { input?: { type?: string } } } } };
    expect(body.accepts?.length).toBeGreaterThan(0);
    expect(body.accepts?.[0]?.network).toBe("eip155:84532");
    expect(body.extensions?.bazaar?.info?.input?.type).toBe("http");
    const input = body.extensions?.bazaar?.info?.input as { method?: string; body?: { authorized?: boolean } };
    expect(input.method).toBe("POST");
    expect(input.body?.authorized).toBe(true);
    expect(response.headers.get("payment-required")).toBeTruthy();
    expect(facilitator.calls.map((call) => call.path)).toEqual(["/supported"]);
    expect(fetchImpl.urls.some((url) => url.endsWith("/robots.txt"))).toBe(true);
  });

  it("settles a correct Base Sepolia payment and does not settle a timeout", async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line) => {
      if (typeof line === "string" && line.includes("domainHash")) logs.push(line);
    });
    const fetchImpl = pageFetch();
    const env = makeEnv(facilitator.url, memoryKv());
    const app = createApp({
      fetchImpl,
      resolveAddresses: publicDns(),
      inspect: inspectOk(),
      now: () => new Date("2026-11-18T12:00:00.000Z"),
    });
    const first = await call(app, scanRequest(), env);
    expect(first.status).toBe(402);
    const required = (await first.json()) as PaymentRequired;
    const { client } = await paymentClient();
    const payload = await client.createPaymentPayload(required);
    const paid = await call(app, scanRequest(payload), env);
    expect(paid.status).toBe(200);
    const settled = facilitator.calls.find((entry) => entry.path === "/settle");
    expect(settled?.body?.paymentPayload?.resource?.url).toContain("/api/v1/scan/page");
    expect(settled?.body?.paymentPayload?.extensions?.bazaar).toBeTruthy();
    const result = (await paid.json()) as { violations: Array<{ ruleId: string }> };
    expect(result.violations.map((item) => item.ruleId)).toContain("image-alt");
    expect(facilitator.calls.filter((call) => call.path === "/settle")).toHaveLength(1);
    expect(logs).toHaveLength(1);
    const entry = JSON.parse(logs[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toEqual({
      timestamp: "2026-11-18T12:00:00.000Z",
      tool: "scan_page",
      price: 0.05,
      tx: "0xtesthash",
      payer: PAYER,
      domainHash: await hashDomain("example.com"),
    });
    expect(JSON.stringify(entry)).not.toContain("example.com");

    const timed = createApp({
      fetchImpl: pageFetch(),
      resolveAddresses: publicDns(),
      inspect: async () => {
        throw new PageTimeoutError();
      },
      now: () => new Date("2026-11-18T12:00:00.000Z"),
    });
    const before = facilitator.calls.filter((call) => call.path === "/settle").length;
    const challenge = await call(timed, scanRequest(), env);
    const secondRequired = (await challenge.json()) as PaymentRequired;
    const timeoutPayload = await client.createPaymentPayload(secondRequired);
    const timeout = await call(timed, scanRequest(timeoutPayload), env);
    expect(timeout.status).toBe(504);
    expect(facilitator.calls.filter((call) => call.path === "/settle")).toHaveLength(before);
    spy.mockRestore();
  });

  it("rejects the wrong amount and a replayed payment", async () => {
    const env = makeEnv(facilitator.url, memoryKv());
    const app = createApp({
      fetchImpl: pageFetch(),
      resolveAddresses: publicDns(),
      inspect: inspectOk(),
      now: () => new Date("2026-11-18T12:00:00.000Z"),
    });
    const challenge = await call(app, scanRequest(), env);
    const required = (await challenge.json()) as PaymentRequired;
    const { client } = await paymentClient();
    const payload = await client.createPaymentPayload(required);
    const tampered = structuredClone(payload) as PaymentPayload & { accepted?: { amount?: string } };
    if (tampered.accepted) tampered.accepted.amount = "1";
    const wrong = await call(app, scanRequest(tampered), env);
    expect(wrong.status).toBe(402);
    expect(facilitator.calls.filter((call) => call.path === "/settle")).toHaveLength(0);

    const ok = await call(app, scanRequest(payload), env);
    expect(ok.status).toBe(200);
    const replay = await call(app, scanRequest(payload), env);
    expect(replay.status).toBe(402);
    const replayBody = (await replay.json()) as { error?: string };
    expect(replayBody.error).toBe("replayed");
    expect(facilitator.calls.filter((call) => call.path === "/settle")).toHaveLength(1);
  });

  it("returns 402 for an unpaid empty body and refuses a paid call without consent before settlement", async () => {
    const fetchImpl = pageFetch();
    const env = makeEnv(facilitator.url, memoryKv());
    const app = createApp({
      fetchImpl,
      resolveAddresses: publicDns(),
      inspect: inspectOk(),
      now: () => new Date("2026-11-18T12:00:00.000Z"),
    });
    const empty = await call(
      app,
      new Request("https://a11y-probe.example/api/v1/scan/page", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.11" },
        body: "",
      }),
      env,
    );
    expect(empty.status).toBe(402);
    expect(empty.headers.get("payment-required")).toBeTruthy();
    const missing = await call(
      app,
      new Request("https://a11y-probe.example/api/v1/scan/site", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.12" },
        body: JSON.stringify({ start_url: "https://example.com/" }),
      }),
      env,
    );
    expect(missing.status).toBe(402);
    expect(missing.headers.get("payment-required")).toBeTruthy();
    expect(fetchImpl.urls.some((url) => url.includes("example.com"))).toBe(false);

    const challenge = await call(app, scanRequest(), env);
    const required = (await challenge.json()) as PaymentRequired;
    const { client } = await paymentClient();
    const payload = await client.createPaymentPayload(required);
    const settles = facilitator.calls.filter((entry) => entry.path === "/settle").length;
    const verifies = facilitator.calls.filter((entry) => entry.path === "/verify").length;
    const headers = new Headers({
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.13",
      "payment-signature": btoa(JSON.stringify(payload)),
    });
    const refused = await call(
      app,
      new Request("https://a11y-probe.example/api/v1/scan/page", {
        method: "POST",
        headers,
        body: JSON.stringify({ url: "https://example.com/" }),
      }),
      env,
    );
    expect(refused.status).toBe(400);
    const refusedBody = (await refused.json()) as { error?: { code?: string } };
    expect(refusedBody.error?.code).toBe("unauthorized");
    expect(facilitator.calls.filter((entry) => entry.path === "/settle")).toHaveLength(settles);
    expect(facilitator.calls.filter((entry) => entry.path === "/verify")).toHaveLength(verifies);
  });

  it("rejects a cap and a rate limit before payment", async () => {
    const domainHash = await hashDomain("example.com");
    const kv = memoryKv({ [`domain:2026-11-18:${domainHash}`]: "50" });
    const capped = createApp({
      fetchImpl: pageFetch(),
      resolveAddresses: publicDns(),
      inspect: inspectOk(),
      now: () => new Date("2026-11-18T12:00:00.000Z"),
    });
    const capResponse = await call(capped, scanRequest(), makeEnv(facilitator.url, kv));
    expect(capResponse.status).toBe(429);
    expect(capResponse.headers.get("payment-required")).toBeNull();
    expect(facilitator.calls).toEqual([]);

    const limited = createApp({
      fetchImpl: pageFetch(),
      resolveAddresses: publicDns(),
      inspect: inspectOk(),
    });
    const rateResponse = await call(limited, scanRequest(), makeEnv(facilitator.url, memoryKv(), () => false));
    expect(rateResponse.status).toBe(429);
    expect(facilitator.calls).toEqual([]);
  });

  it("refuses a disallowed robots.txt rule without a payment challenge", async () => {
    const app = createApp({
      fetchImpl: pageFetch(),
      resolveAddresses: publicDns(),
      inspect: inspectOk(),
    });
    const response = await call(
      app,
      new Request("https://a11y-probe.example/api/v1/scan/page", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://blocked.example/", authorized: true }),
      }),
      makeEnv(facilitator.url, memoryKv()),
    );
    expect(response.status).toBe(403);
    expect(facilitator.calls).toEqual([]);
  });

  it("pays for an MCP scan_page call with withX402Client", async () => {
    const fetchImpl = pageFetch();
    const env = makeEnv(facilitator.url, memoryKv());
    const app = createApp({
      fetchImpl,
      resolveAddresses: publicDns(),
      inspect: inspectOk(),
      now: () => new Date("2026-11-18T12:00:00.000Z"),
    });
    const worker = await listen(async (req, res, raw) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(key, value);
      }
      const request = new Request(`http://127.0.0.1${req.url}`, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : raw,
      });
      const response = await call(app, request, env);
      const bytes = Buffer.from(await response.arrayBuffer());
      const out: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        out[key] = value;
      });
      res.writeHead(response.status, out);
      res.end(bytes);
    });
    const mcp = new Client({ name: "payment-test", version: "0.0.1" });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${worker.url}/mcp`)));
    const unpaid = await mcp.callTool({
      name: "scan_page",
      arguments: { url: "https://example.com/", authorized: true },
    });
    const unpaidMeta = unpaid._meta as { "x402/error"?: { accepts?: unknown[]; extensions?: { bazaar?: { info?: { input?: { toolName?: string } } } } } } | undefined;
    expect(unpaid.isError).toBe(true);
    expect(unpaidMeta?.["x402/error"]?.accepts?.length).toBeGreaterThan(0);
    expect(unpaidMeta?.["x402/error"]?.extensions?.bazaar?.info?.input?.toolName).toBe("scan_page");

    const { account } = await paymentClient();
    const paying = withX402Client(mcp, { account, network: "eip155:84532" });
    const paid = await paying.callTool(null, {
      name: "scan_page",
      arguments: { url: "https://example.com/", authorized: true },
    });
    expect(paid.isError).toBeFalsy();
    const text = (paid.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(text).toContain("image-alt");
    expect(facilitator.calls.filter((call) => call.path === "/settle").length).toBeGreaterThan(0);
    await mcp.close();
    await worker.close();
  });
});

function scanRequest(payload?: PaymentPayload): Request {
  const headers = new Headers({
    "content-type": "application/json",
    "cf-connecting-ip": "203.0.113.9",
  });
  if (payload) headers.set("payment-signature", btoa(JSON.stringify(payload)));
  return new Request("https://a11y-probe.example/api/v1/scan/page", {
    method: "POST",
    headers,
    body: JSON.stringify({ url: "https://example.com/", authorized: true }),
  });
}
