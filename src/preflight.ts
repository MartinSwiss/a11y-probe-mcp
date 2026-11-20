import { LIMITS, REPORT_LANGUAGES, STANDARDS, type ReportLanguage, type Standard } from "./config";
import { checkPageCaps, type CapStore } from "./limits";
import { authorisePublicDocument } from "./scan/fetch-document";
import type { ScanDeps } from "./scan/scan";
import { normaliseUrl } from "./scan/url";

export interface PaidRequest {
  tool: "scan_page" | "scan_site" | "report";
  url: string;
  pages: number;
  standard?: Standard;
  language?: ReportLanguage;
}

export interface InputFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export type Preflight = { ok: true; domainHash: string; hostname: string; url: string } | InputFailure;

export function readPaidRequest(tool: string, args: unknown): PaidRequest | InputFailure {
  if (tool !== "scan_page" && tool !== "scan_site" && tool !== "report") {
    return { ok: false, status: 400, code: "invalid_input", message: "Unknown tool" };
  }
  if (!args || typeof args !== "object") {
    return { ok: false, status: 400, code: "invalid_input", message: "JSON object body is required" };
  }
  const record = args as Record<string, unknown>;
  if (record.authorized !== true) {
    return { ok: false, status: 400, code: "unauthorized", message: "authorized must be true" };
  }
  const standard = record.standard;
  if (standard !== undefined && (typeof standard !== "string" || !(STANDARDS as readonly string[]).includes(standard))) {
    return { ok: false, status: 400, code: "invalid_input", message: "standard is not supported" };
  }
  if (tool === "scan_page") {
    if (typeof record.url !== "string") {
      return { ok: false, status: 400, code: "invalid_input", message: "url is required" };
    }
    return { tool, url: record.url, pages: 1, ...(standard ? { standard: standard as Standard } : {}) };
  }
  if (typeof record.start_url !== "string") {
    return { ok: false, status: 400, code: "invalid_input", message: "start_url is required" };
  }
  const maxPages = record.max_pages === undefined ? 1 : record.max_pages;
  if (typeof maxPages !== "number" || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > LIMITS.maxPagesPerCall) {
    return {
      ok: false,
      status: 400,
      code: "invalid_input",
      message: `max_pages must be an integer from 1 to ${LIMITS.maxPagesPerCall}`,
    };
  }
  const language = record.language;
  if (language !== undefined && (typeof language !== "string" || !(REPORT_LANGUAGES as readonly string[]).includes(language))) {
    return { ok: false, status: 400, code: "invalid_input", message: "language must be de, fr, or en" };
  }
  return {
    tool,
    url: record.start_url,
    pages: maxPages,
    ...(standard ? { standard: standard as Standard } : {}),
    ...(language ? { language: language as ReportLanguage } : {}),
  };
}

export function isInputFailure(value: PaidRequest | InputFailure | Preflight): value is InputFailure {
  return "ok" in value && value.ok === false;
}

/**
 * Robots, SSRF, and daily caps. Runs before any payment challenge so a blocked
 * scan is free. Does not settle and does not call the facilitator.
 */
export async function preflight(
  request: PaidRequest,
  deps: ScanDeps,
  store: CapStore,
  globalLimit: number,
): Promise<Preflight> {
  const parsed = normaliseUrl(request.url);
  if (!parsed.ok) return { ok: false, status: 400, code: "invalid_input", message: parsed.message };

  const signal = AbortSignal.timeout(LIMITS.pageTimeoutMs);
  const authorised = await authorisePublicDocument(parsed.url.href, {
    fetch: deps.fetch,
    resolveAddresses: deps.resolveAddresses,
    userAgent: deps.userAgent,
    signal,
  });
  if (!authorised.ok) {
    return { ok: false, status: statusFor(authorised.code), code: authorised.code, message: authorised.message };
  }

  const caps = await checkPageCaps(store, {
    hostname: authorised.url.hostname,
    pages: request.pages,
    globalLimit,
    now: deps.now?.() ?? new Date(),
  });
  if (!caps.ok) return { ok: false, status: 429, code: "cap", message: caps.message };
  return { ok: true, domainHash: caps.domainHash, hostname: authorised.url.hostname, url: authorised.url.href };
}

export function statusFor(code: string): number {
  switch (code) {
    case "unauthorized":
    case "invalid_input":
      return 400;
    case "ssrf":
    case "robots":
      return 403;
    case "timeout":
      return 504;
    case "browser_busy":
      return 503;
    case "cap":
      return 429;
    default:
      return 502;
  }
}
