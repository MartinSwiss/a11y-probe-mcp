import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app";
import { resetResourceServers } from "../src/payments/facilitator";
import { sptAllowed, stripeSptChallenge, stripeSptVerifier, recordStripeUsdcPayment } from "../src/payments/stripe-machine";
import { publicDns, scriptedFetch } from "./helpers";

const PAY_TO = "0x2222222222222222222222222222222222222222";
const DEPOSIT = "0x3333333333333333333333333333333333333333";

async function call(app: ExportedHandler<Env>, request: Request, env: Env): Promise<Response> {
  if (!app.fetch) throw new Error("missing fetch");
  return app.fetch(request as never, env, {} as ExecutionContext);
}

function makeEnv(facilitator: string, extra: Record<string, string> = {}): Env {
  return {
    INFO_URL: "https://a11y-probe.example/",
    X402_NETWORK: "eip155:84532",
    FACILITATOR_URL: facilitator,
    GLOBAL_DAILY_PAGE_CAP: "20",
    PAY_TO,
    CDP_API_KEY_ID: "",
    CDP_API_KEY_SECRET: "",
    CAPS: { get: async () => null, put: async () => undefined },
    RATE_LIMITER: { limit: async () => ({ success: true }) },
    BROWSER: {},
    ...extra,
  } as unknown as Env;
}

function startFacilitator(): Promise<{ url: string; calls: string[]; close: () => Promise<void> }> {
  const calls: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    calls.push(req.url ?? "");
    const send = (body: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/supported") {
      send({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }], extensions: ["bazaar"], signers: {} });
      return;
    }
    send({ isValid: false, invalidReason: "unused" });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        calls,
        close: () => new Promise((done, reject) => server.close((error) => (error ? reject(error) : done()))),
      });
    });
  });
}

describe("Stripe machine payments flag", () => {
  let facilitator: Awaited<ReturnType<typeof startFacilitator>>;

  beforeEach(async () => {
    resetResourceServers();
    facilitator = await startFacilitator();
  });

  afterEach(async () => {
    await facilitator.close();
  });

  it("leaves the 402 unchanged when the flag is off", async () => {
    const app = createApp({ fetchImpl: scriptedFetch({}), resolveAddresses: publicDns(), now: () => new Date("2026-11-18T12:00:00.000Z") });
    const request = () =>
      new Request("https://a11y-probe.example/api/v1/scan/page", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "",
      });
    const off = await call(app, request(), makeEnv(facilitator.url));
    const explicit = await call(app, request(), makeEnv(facilitator.url, { STRIPE_MACHINE_PAYMENTS: "false" }));
    expect(off.status).toBe(402);
    expect(await off.text()).toBe(await explicit.text());
    expect(off.headers.get("payment-required")).toBe(explicit.headers.get("payment-required"));
    expect(off.headers.get("www-authenticate")).toBeNull();
  });

  it("advertises the CDP option first and the Stripe deposit second", async () => {
    const app = createApp({ fetchImpl: scriptedFetch({}), resolveAddresses: publicDns() });
    const response = await call(
      app,
      new Request("https://a11y-probe.example/api/v1/scan/page", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "",
      }),
      makeEnv(facilitator.url, {
        STRIPE_MACHINE_PAYMENTS: "true",
        STRIPE_DEPOSIT_ADDRESS: DEPOSIT,
        STRIPE_SECRET_KEY: "sk_test_example",
        STRIPE_PROFILE_ID: "profile_test_example",
      }),
    );
    expect(response.status).toBe(402);
    const body = (await response.json()) as { accepts?: Array<{ payTo?: string; network?: string }> };
    expect(body.accepts?.[0]?.payTo?.toLowerCase()).toBe(PAY_TO.toLowerCase());
    expect(body.accepts?.[1]?.payTo?.toLowerCase()).toBe(DEPOSIT.toLowerCase());
    expect(body.accepts?.[1]?.network).toBe("eip155:84532");
    expect(response.headers.get("www-authenticate")).toBeNull();
  });

  it("offers an SPT challenge only at the 0.50 USD minimum and does not scan when Stripe rejects it", async () => {
    expect(sptAllowed(0.05)).toBe(false);
    expect(sptAllowed(0.5)).toBe(true);
    expect(sptAllowed(1)).toBe(true);

    let scanned = false;
    const app = createApp({
      fetchImpl: scriptedFetch({
        "https://example.com/robots.txt": { status: 404 },
        "https://example.com/": { status: 200, body: "<html></html>", headers: { "content-type": "text/html" } },
      }),
      resolveAddresses: publicDns(),
      now: () => new Date("2026-11-18T12:00:00.000Z"),
      inspect: async () => {
        scanned = true;
        throw new Error("scan must not run");
      },
      stripeFetch: async () => new Response(JSON.stringify({ error: { message: "card_declined" } }), { status: 402 }),
    });
    const env = makeEnv(facilitator.url, {
      STRIPE_MACHINE_PAYMENTS: "true",
      STRIPE_DEPOSIT_ADDRESS: DEPOSIT,
      STRIPE_SECRET_KEY: "sk_test_example",
      STRIPE_PROFILE_ID: "profile_test_example",
    });
    const site = await call(
      app,
      new Request("https://a11y-probe.example/api/v1/scan/site", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "",
      }),
      env,
    );
    expect(site.status).toBe(402);
    const www = site.headers.get("www-authenticate") ?? "";
    expect(www).toContain('method="stripe"');
    expect(www).toContain('intent="charge"');
    const encoded = /request="([^"]+)"/.exec(www)?.[1] ?? "";
    const request = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      amount?: string;
      currency?: string;
      decimals?: number;
      methodDetails?: { networkId?: string; paymentMethodTypes?: string[] };
    };
    expect(request.amount).toBe("50");
    expect(request.currency).toBe("usd");
    expect(request.decimals).toBe(2);
    expect(request.methodDetails?.networkId).toBe("profile_test_example");
    expect(request.methodDetails?.paymentMethodTypes).toEqual(["card", "link"]);

    const refused = await call(
      app,
      new Request("https://a11y-probe.example/api/v1/report", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "payment-authorization": JSON.stringify({ spt: "spt_test_declined" }),
        },
        body: JSON.stringify({ start_url: "https://example.com/", authorized: true }),
      }),
      env,
    );
    expect(refused.status).toBe(402);
    expect(scanned).toBe(false);
    expect(facilitator.calls.filter((path) => path === "/settle")).toEqual([]);
  });
});

describe("Stripe HTTP calls", () => {
  it("builds a bound SPT challenge and records USDC without putting the key in the body", async () => {
    const challenge = await stripeSptChallenge({
      secretKey: "sk_test_example",
      profileId: "profile_test_example",
      priceUsd: 1,
      resourceUrl: "https://a11y-probe.example/api/v1/report",
      description: "report",
      now: new Date("2026-11-18T12:00:00.000Z"),
    });
    expect(challenge.request.amount).toBe("100");
    expect(challenge.header).not.toContain("sk_test_example");

    let body = "";
    const recorded = await recordStripeUsdcPayment({
      secretKey: "sk_test_example",
      amountAtomic: "10000",
      transactionHash: "0xabc",
      fetchImpl: async (_url, init) => {
        body = String(init?.body ?? "");
        expect(String((init?.headers as Record<string, string>).authorization)).toBe("Bearer sk_test_example");
        return new Response(JSON.stringify({ id: "pi_test" }));
      },
    });
    expect(recorded).toEqual({ ok: true, id: "pi_test" });
    const decoded = decodeURIComponent(body);
    expect(decoded).toContain("transaction_verification");
    expect(decoded).toContain("network]=base");
    expect(decoded).toContain("transaction_hash]=0xabc");
    expect(body).not.toContain("sk_test_example");

    const verifier = stripeSptVerifier("sk_test_example", async () => new Response("no", { status: 402 }));
    const failed = await verifier.verify({ credential: "spt_test", amountCents: "50", resourceUrl: "https://a11y-probe.example/api/v1/report" });
    expect(failed.ok).toBe(false);
  });
});
