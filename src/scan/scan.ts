import {
  DEFAULT_STANDARD,
  LIMITS,
  STANDARDS,
  type Standard,
} from "../config";
import { BrowserBusyError, PageTimeoutError } from "./errors";
import { authorisePublicDocument, fetchPublicDocument, type DocumentDeps } from "./fetch-document";
import { extractLinks } from "./links";
import { aggregateIssues, mapAxeResults } from "./map-results";
import {
  failure,
  type RawAxeResults,
  type ScanFailure,
  type ScanPageResult,
  type ScanSiteResult,
} from "./types";

export interface ScanPageInput {
  url: string;
  standard?: Standard;
  authorized: boolean;
}

export interface ScanSiteInput {
  start_url: string;
  max_pages?: number;
  standard?: Standard;
  authorized: boolean;
}

export interface InspectedDocument {
  raw: RawAxeResults;
  links: string[];
}

export interface ScanDeps {
  fetch: typeof fetch;
  resolveAddresses: (hostname: string) => Promise<string[]>;
  userAgent: string;
  now?: () => Date;
  /**
   * Rule engine for HTML already fetched by this module.
   * Tests and the HTTP loader use this. Ignored when `inspect` is set.
   */
  auditHtml: (html: string, standard: Standard) => Promise<RawAxeResults>;
  /**
   * Browser Run loader. When set, the URL is authorised (SSRF, robots,
   * redirects) and then loaded in the browser, where the rule engine runs.
   */
  inspect?: (url: URL, standard: Standard, signal: AbortSignal) => Promise<InspectedDocument>;
}

export type PageOutcome = { ok: true; result: ScanPageResult } | ScanFailure;
export type SiteOutcome = { ok: true; result: ScanSiteResult } | ScanFailure;

interface Audited {
  ok: true;
  result: ScanPageResult;
  links: string[];
}

export async function scanPage(input: ScanPageInput, deps: ScanDeps): Promise<PageOutcome> {
  const prepared = prepare(input.authorized, input.standard);
  if (!prepared.ok) return prepared;
  const signal = AbortSignal.timeout(LIMITS.pageTimeoutMs);
  const audited = await auditUrl(input.url, prepared.standard, deps, signal);
  if (!audited.ok) return audited;
  return { ok: true, result: audited.result };
}

export async function scanSite(input: ScanSiteInput, deps: ScanDeps): Promise<SiteOutcome> {
  const prepared = prepare(input.authorized, input.standard);
  if (!prepared.ok) return prepared;
  const maxPages = input.max_pages ?? 1;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > LIMITS.maxPagesPerCall) {
    return failure(
      "invalid_input",
      `max_pages must be an integer from 1 to ${LIMITS.maxPagesPerCall}`,
    );
  }

  const cache: DocumentDeps["robotsCache"] = new Map();
  const firstSignal = AbortSignal.timeout(LIMITS.pageTimeoutMs);
  const first = await auditUrl(input.start_url, prepared.standard, deps, firstSignal, cache);
  if (!first.ok) return first;

  const origin = new URL(first.result.url).origin;
  const pages: ScanPageResult[] = [first.result];
  const skipped: ScanSiteResult["skipped"] = [];
  const seen = new Set<string>([first.result.url]);
  const queue = first.links.filter((link) => sameSite(link, origin) && !seen.has(link));

  while (queue.length > 0 && pages.length < maxPages) {
    const next = queue.shift();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    const signal = AbortSignal.timeout(LIMITS.pageTimeoutMs);
    const audited = await auditUrl(next, prepared.standard, deps, signal, cache);
    if (!audited.ok) {
      if (audited.code === "ssrf" || audited.code === "unauthorized" || audited.code === "invalid_input") {
        continue;
      }
      if (audited.code === "robots") {
        skipped.push({ url: next, reason: "robots" });
        continue;
      }
      if (audited.code === "timeout" || audited.code === "browser_busy") {
        skipped.push({ url: next, reason: "timeout" });
        continue;
      }
      skipped.push({ url: next, reason: "fetch_failed" });
      continue;
    }
    if (new URL(audited.result.url).origin !== origin) continue;
    pages.push(audited.result);
    for (const link of audited.links) {
      if (!seen.has(link) && !queue.includes(link) && sameSite(link, origin)) queue.push(link);
    }
  }

  const timestamp = (deps.now?.() ?? new Date()).toISOString();
  return {
    ok: true,
    result: {
      startUrl: first.result.url,
      standard: prepared.standard,
      pagesScanned: pages.length,
      pages,
      topIssues: aggregateIssues(pages),
      skipped,
      engineVersion: pages[0]?.engineVersion ?? "",
      timestamp,
    },
  };
}

async function auditUrl(
  input: string,
  standard: Standard,
  deps: ScanDeps,
  signal: AbortSignal,
  robotsCache?: DocumentDeps["robotsCache"],
): Promise<Audited | ScanFailure> {
  const documentDeps = toDocumentDeps(deps, signal, robotsCache);
  try {
    if (deps.inspect) {
      const authorised = await authorisePublicDocument(input, documentDeps);
      if (!authorised.ok) return authorised;
      const inspected = await deps.inspect(authorised.url, standard, signal);
      const links = inspected.links.filter((link) => sameSite(link, authorised.url.origin));
      const timestamp = (deps.now?.() ?? new Date()).toISOString();
      return {
        ok: true,
        result: mapAxeResults(inspected.raw, { url: authorised.url.href, standard, timestamp }),
        links,
      };
    }

    const loaded = await fetchPublicDocument(input, documentDeps);
    if (!loaded.ok) return loaded;
    const raw = await deps.auditHtml(loaded.html, standard);
    const links = extractLinks(loaded.html, loaded.url).map((url) => url.href);
    const timestamp = (deps.now?.() ?? new Date()).toISOString();
    return {
      ok: true,
      result: mapAxeResults(raw, { url: loaded.url.href, standard, timestamp }),
      links,
    };
  } catch (error) {
    if (error instanceof PageTimeoutError || (error instanceof Error && error.name === "AbortError")) {
      return failure("timeout", "Page exceeded the 30s limit");
    }
    if (error instanceof BrowserBusyError) {
      return failure("browser_busy", "Browser capacity is exhausted. Try again later.");
    }
    return failure("fetch_failed", "Scan engine failed");
  }
}

function sameSite(link: string, origin: string): boolean {
  try {
    return new URL(link).origin === origin;
  } catch {
    return false;
  }
}

function prepare(
  authorized: boolean,
  standard: Standard | undefined,
): { ok: true; standard: Standard } | ScanFailure {
  if (authorized !== true) return failure("unauthorized", "authorized must be true");
  const chosen = standard ?? DEFAULT_STANDARD;
  if (!(STANDARDS as readonly string[]).includes(chosen)) {
    return failure("invalid_input", "standard is not supported");
  }
  return { ok: true, standard: chosen };
}

function toDocumentDeps(
  deps: ScanDeps,
  signal: AbortSignal,
  robotsCache?: DocumentDeps["robotsCache"],
): DocumentDeps {
  return {
    fetch: deps.fetch,
    resolveAddresses: deps.resolveAddresses,
    userAgent: deps.userAgent,
    signal,
    ...(robotsCache ? { robotsCache } : {}),
  };
}
