import { createMcpHandler } from "agents/mcp/server";
import { getPricing, PRICES_USD, userAgent } from "./config";
import { commitPages, clientKey, kvCapStore, bindingLimiter } from "./limits";
import { logPayment } from "./log";
import { createMcpServer } from "./mcp";
import { bazaarForHttp, bazaarForTool, pageDescription, reportDescription, siteDescription } from "./payments/bazaar";
import { charge } from "./payments/gate";
import { PayToError, assertPayTo, payToAddress } from "./payments/facilitator";
import { isInputFailure, preflight, readPaidRequest, statusFor, type PaidRequest } from "./preflight";
import { buildReport } from "./scan/report";
import { scanPage, scanSite, type ScanDeps } from "./scan/scan";
import { boundFetch, resolveWithDoh } from "./scan/ssrf";

export interface AppOptions {
  /** Browser Run stand-in. Production wires the real browser binding from index.ts. */
  inspect?: ScanDeps["inspect"];
  createInspect?: (env: Env) => ScanDeps["inspect"];
  fetchImpl?: typeof fetch;
  resolveAddresses?: (hostname: string) => Promise<string[]>;
  now?: () => Date;
}

const PAID = new Set(["scan_page", "scan_site", "report"]);

export function createApp(options: AppOptions = {}): ExportedHandler<Env> {
  return {
    async fetch(request, env, ctx) {
      return route(request, env, ctx, options);
    },
  };
}

async function route(request: Request, env: Env, ctx: ExecutionContext, options: AppOptions): Promise<Response> {
  try {
    assertPayTo(env.PAY_TO);
  } catch (error) {
    if (error instanceof PayToError) {
      return json({ error: { code: "payee", message: "PAY_TO is not configured" } }, 503);
    }
    throw error;
  }
  const url = new URL(request.url);
  if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (url.pathname === "/mcp") return handleMcp(request, env, ctx, options);
  if (url.pathname === "/api/v1/pricing" && request.method === "GET") {
    return json(getPricing({ infoUrl: env.INFO_URL, globalDailyPageCap: numberCap(env) }), 200);
  }
  if (url.pathname === "/api/v1/scan/page" && request.method === "POST") {
    return handleHttp(request, env, options, "scan_page");
  }
  if (url.pathname === "/api/v1/scan/site" && request.method === "POST") {
    return handleHttp(request, env, options, "scan_site");
  }
  if (url.pathname === "/api/v1/report" && request.method === "POST") {
    return handleHttp(request, env, options, "report");
  }
  if (url.pathname === "/") {
    return json({ name: "a11y-probe-mcp", pricing: "/api/v1/pricing", mcp: "/mcp" }, 200);
  }
  return json({ error: { code: "not_found", message: "Not found" } }, 404);
}

async function handleHttp(request: Request, env: Env, options: AppOptions, tool: PaidRequest["tool"]): Promise<Response> {
  let args: unknown;
  try {
    args = await request.json();
  } catch {
    return json({ error: { code: "invalid_input", message: "JSON object body is required" } }, 400);
  }
  const paid = readPaidRequest(tool, args);
  if (isInputFailure(paid)) return json({ error: { code: paid.code, message: paid.message } }, paid.status);

  const limited = await limit(request, env, request.headers.get("payment-signature") ?? request.headers.get("x-payment"));
  if (limited) return limited;

  const deps = scanDependencies(env, options);
  const ready = await preflight(paid, deps, kvCapStore(env.CAPS), numberCap(env));
  if (!ready.ok) return json({ error: { code: ready.code, message: ready.message } }, ready.status);

  const descriptions = { scan_page: pageDescription(), scan_site: siteDescription(), report: reportDescription() };
  const charged = await charge(env, {
    price: PRICES_USD[tool],
    resourceUrl: new URL(request.url).href,
    description: descriptions[tool],
    paymentToken: request.headers.get("payment-signature") ?? request.headers.get("x-payment"),
    extensions: bazaarForHttp(new URL(request.url).pathname),
  });
  if (charged.state === "error") return json(charged.body, charged.status);
  if (charged.state === "challenge") return json(charged.body, charged.status, charged.headers);

  const outcome = await runPaid(paid, deps);
  if (!outcome.ok) return json({ error: { code: outcome.code, message: outcome.message } }, statusFor(outcome.code));

  const settled = await charged.settle();
  if (!settled.ok) return json(settled.body, settled.status);

  const now = deps.now?.() ?? new Date();
  await commitPages(kvCapStore(env.CAPS), ready.domainHash, outcome.pages, now);
  logPayment({
    timestamp: now.toISOString(),
    tool,
    price: PRICES_USD[tool],
    tx: settled.settlement.transaction,
    payer: settled.settlement.payer,
    domainHash: ready.domainHash,
  });
  const headers = new Headers({ "payment-response": btoa(JSON.stringify(settled.settlement)) });
  const payload = "markdown" in outcome ? { markdown: outcome.markdown } : outcome.result;
  return json(payload, 200, headers);
}

async function handleMcp(request: Request, env: Env, ctx: ExecutionContext, options: AppOptions): Promise<Response> {
  const parsed = await readRpc(request);
  const tool = parsed?.method === "tools/call" && typeof parsed.params?.name === "string" ? parsed.params.name : undefined;
  let domainHash: string | undefined;
  let pages = 1;

  if (tool && PAID.has(tool)) {
    if (!payToAddress(env.PAY_TO)) {
      return rpcError(parsed?.id, 503, "PAY_TO is not configured");
    }
    const token = paymentToken(parsed?.params?._meta, request);
    const limited = await limit(request, env, token);
    if (limited) return limited;
    const paid = readPaidRequest(tool, parsed?.params?.arguments);
    if (isInputFailure(paid)) return rpcError(parsed?.id, paid.status, paid.message);
    pages = paid.pages;
    const ready = await preflight(paid, scanDependencies(env, options), kvCapStore(env.CAPS), numberCap(env));
    if (!ready.ok) return rpcError(parsed?.id, ready.status, ready.message);
    domainHash = ready.domainHash;
  }

  let handler;
  try {
    handler = createMcpHandler(() => createMcpServer(env, scanDependencies(env, options)));
  } catch {
    return rpcError(parsed?.id, 503, "Payment facilitator is not available");
  }
  let response: Response;
  try {
    response = await handler(request, env, ctx);
  } catch {
    return rpcError(parsed?.id, 503, "Payment facilitator is not available");
  }
  if (!tool || !PAID.has(tool) || !domainHash) return response;
  return finishMcp(response, {
    tool,
    domainHash,
    pages,
    env,
    now: options.now?.() ?? new Date(),
  });
}

async function finishMcp(
  response: Response,
  context: { tool: string; domainHash: string; pages: number; env: Env; now: Date },
): Promise<Response> {
  const type = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (type.includes("text/event-stream")) {
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] ?? "";
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (await decorateToolResult(parsed, context)) lines[index] = `data: ${JSON.stringify(parsed)}`;
      } catch {
        // Leave non-JSON SSE fields untouched.
      }
    }
    return new Response(lines.join("\n"), { status: response.status, headers: response.headers });
  }
  try {
    const body = JSON.parse(text) as unknown;
    await decorateToolResult(body, context);
    return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
  } catch {
    return new Response(text, { status: response.status, headers: response.headers });
  }
}

async function decorateToolResult(
  body: unknown,
  context: { tool: string; domainHash: string; pages: number; env: Env; now: Date },
): Promise<boolean> {
  const record = body as {
    result?: { _meta?: Record<string, unknown>; content?: Array<{ text?: string }>; isError?: boolean };
  };
  const meta = record.result?._meta;
  if (!meta) return false;
  const paymentError = meta["x402/error"];
  if (paymentError && typeof paymentError === "object") {
    const error = paymentError as { extensions?: Record<string, unknown> };
    error.extensions = { ...error.extensions, ...bazaarForTool(context.tool as "scan_page") };
  }
  const receipt = meta["x402/payment-response"] as { success?: boolean; transaction?: string; payer?: string } | undefined;
  if (receipt?.success && receipt.transaction && !record.result?.isError) {
    const delivered = pagesDelivered(record.result?.content?.[0]?.text, context.pages);
    await commitPages(kvCapStore(context.env.CAPS), context.domainHash, delivered, context.now);
    logPayment({
      timestamp: context.now.toISOString(),
      tool: context.tool,
      price: PRICES_USD[context.tool as "scan_page"],
      tx: receipt.transaction,
      payer: receipt.payer ?? "",
      domainHash: context.domainHash,
    });
  }
  return true;
}

function pagesDelivered(text: string | undefined, fallback: number): number {
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text) as { pagesScanned?: number };
    if (typeof parsed.pagesScanned === "number" && parsed.pagesScanned > 0) return parsed.pagesScanned;
  } catch {
    // A report is Markdown, so the reserved page count is what we commit.
  }
  return fallback;
}

async function runPaid(
  request: PaidRequest,
  deps: ScanDeps,
): Promise<{ ok: true; result?: unknown; markdown?: string; pages: number } | { ok: false; code: string; message: string }> {
  if (request.tool === "scan_page") {
    const outcome = await scanPage(
      { url: request.url, authorized: true, ...(request.standard ? { standard: request.standard } : {}) },
      deps,
    );
    if (!outcome.ok) return outcome;
    return { ok: true, result: outcome.result, pages: 1 };
  }
  if (request.tool === "scan_site") {
    const outcome = await scanSite(
      {
        start_url: request.url,
        max_pages: request.pages,
        authorized: true,
        ...(request.standard ? { standard: request.standard } : {}),
      },
      deps,
    );
    if (!outcome.ok) return outcome;
    return { ok: true, result: outcome.result, pages: outcome.result.pagesScanned };
  }
  const outcome = await buildReport(
    {
      start_url: request.url,
      max_pages: request.pages,
      authorized: true,
      ...(request.standard ? { standard: request.standard } : {}),
      ...(request.language ? { language: request.language } : {}),
    },
    deps,
  );
  if (!outcome.ok) return outcome;
  return { ok: true, markdown: outcome.markdown, pages: outcome.result.pagesScanned };
}

async function limit(request: Request, env: Env, token: string | null): Promise<Response | undefined> {
  const allowed = await bindingLimiter(env.RATE_LIMITER).limit(clientKey(request, token));
  if (allowed) return undefined;
  return json({ error: { code: "rate_limit", message: "Rate limit exceeded. Try again in a minute." } }, 429);
}

export function scanDependencies(env: Env, options: AppOptions): ScanDeps {
  const fetchImpl = options.fetchImpl ?? boundFetch;
  const resolveAddresses = options.resolveAddresses ?? ((hostname: string) => resolveWithDoh(hostname, fetchImpl));
  const agent = userAgent(env.INFO_URL);
  return {
    fetch: fetchImpl,
    resolveAddresses,
    userAgent: agent,
    ...(options.now ? { now: options.now } : {}),
    auditHtml: async () => {
      throw new Error("The worker runs the rule engine in the browser");
    },
    inspect:
      options.inspect ??
      options.createInspect?.(env) ??
      (async () => {
        throw new Error("No browser inspect function is configured");
      }),
  };
}

function numberCap(env: Env): number {
  const parsed = Number(env.GLOBAL_DAILY_PAGE_CAP);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
}

async function readRpc(request: Request): Promise<{ id?: unknown; method?: string; params?: { name?: string; arguments?: unknown; _meta?: unknown } } | undefined> {
  if (request.method === "GET") return undefined;
  try {
    return (await request.clone().json()) as {
      id?: unknown;
      method?: string;
      params?: { name?: string; arguments?: unknown; _meta?: unknown };
    };
  } catch {
    return undefined;
  }
}

function paymentToken(meta: unknown, request: Request): string | null {
  const record = meta && typeof meta === "object" ? (meta as Record<string, unknown>) : undefined;
  const fromMeta = record?.["x402/payment"];
  if (typeof fromMeta === "string") return fromMeta;
  return request.headers.get("payment-signature") ?? request.headers.get("x-payment");
}

function rpcError(id: unknown, status: number, message: string): Response {
  return json({ jsonrpc: "2.0", id: id ?? null, error: { code: status === 429 ? -32029 : -32000, message } }, status);
}

function json(body: unknown, status: number, extra?: Headers): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  for (const [key, value] of corsHeaders()) headers.set(key, value);
  return new Response(JSON.stringify(body), { status, headers });
}

function corsHeaders(): Headers {
  return new Headers({
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, payment-signature, x-payment",
    "access-control-expose-headers": "payment-required, payment-response",
  });
}
