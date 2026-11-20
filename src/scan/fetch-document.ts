import { LIMITS } from "../config";
import { readTextLimited } from "./body";
import { isPathAllowed, parseRobots, type RobotGroup } from "./robots";
import { followPublicRedirects, validatePublicUrl, type FollowResult, type GuardDeps } from "./ssrf";
import { originKey } from "./url";
import { failure, type ScanFailure } from "./types";

export interface DocumentDeps extends GuardDeps {
  fetch: typeof fetch;
  userAgent: string;
  signal: AbortSignal;
  robotsCache?: Map<string, RobotGroup[] | "allow" | "deny">;
}

export type DocumentResult = { ok: true; url: URL; html: string } | ScanFailure;

/**
 * Validate the URL, honour robots.txt, follow redirects (re-checking each hop),
 * and return the document HTML. The HTML is capped and is not stored by this
 * function; the caller drops it after mapping.
 */
export async function fetchPublicDocument(input: string, deps: DocumentDeps): Promise<DocumentResult> {
  const followed = await followChecked(input, deps);
  if (!followed.ok) return followed;

  const contentType = followed.response.headers.get("content-type") ?? "";
  if (contentType !== "" && !isDocumentContentType(contentType)) {
    await followed.response.body?.cancel().catch(() => undefined);
    return failure("fetch_failed", "Page is not an HTML document");
  }

  const html = await readTextLimited(followed.response, LIMITS.maxDocumentBytes);
  return { ok: true, url: followed.url, html };
}

/** Robots and redirect checks, discarding the body. Browser Run loads the page itself. */
export async function authorisePublicDocument(
  input: string,
  deps: DocumentDeps,
): Promise<{ ok: true; url: URL } | ScanFailure> {
  const followed = await followChecked(input, deps);
  if (!followed.ok) return followed;
  await followed.response.body?.cancel().catch(() => undefined);
  return { ok: true, url: followed.url };
}

async function followChecked(input: string, deps: DocumentDeps): Promise<FollowResult> {
  // followPublicRedirects re-validates every hop. Robots is checked here for
  // the URL we are about to request, and again when the final URL differs.
  const first = await validatePublicUrl(input, deps);
  if (!first.ok) return first;
  const robots = await robotsDecision(first.url, deps);
  if (!robots.ok) return robots;

  const followed = await followPublicRedirects(first.url.href, deps);
  if (!followed.ok) return followed;
  if (followed.url.href !== first.url.href) {
    const again = await robotsDecision(followed.url, deps);
    if (!again.ok) {
      await followed.response.body?.cancel().catch(() => undefined);
      return again;
    }
  }
  return followed;
}

async function robotsDecision(url: URL, deps: DocumentDeps): Promise<{ ok: true } | ScanFailure> {
  const allowed = await pathAllowed(url, deps);
  if (!allowed.ok) return allowed;
  if (!allowed.allowed) return failure("robots", "robots.txt disallows this URL");
  return { ok: true };
}

async function pathAllowed(
  url: URL,
  deps: DocumentDeps,
): Promise<{ ok: true; allowed: boolean } | ScanFailure> {
  const cache = deps.robotsCache ?? new Map();
  const key = originKey(url);
  let parsed = cache.get(key);
  if (!parsed) {
    const loaded = await loadRobots(url, deps);
    if (!loaded.ok) return loaded;
    parsed = loaded.groups;
    cache.set(key, parsed);
    deps.robotsCache = cache;
  }
  if (parsed === "allow") return { ok: true, allowed: true };
  if (parsed === "deny") return { ok: true, allowed: false };
  return { ok: true, allowed: isPathAllowed(parsed, url.pathname || "/", deps.userAgent) };
}

async function loadRobots(
  url: URL,
  deps: DocumentDeps,
): Promise<{ ok: true; groups: RobotGroup[] | "allow" | "deny" } | ScanFailure> {
  return readRobots(new URL("/robots.txt", url.origin), deps, 0);
}

async function readRobots(
  robotsUrl: URL,
  deps: DocumentDeps,
  depth: number,
): Promise<{ ok: true; groups: RobotGroup[] | "allow" | "deny" } | ScanFailure> {
  if (depth > 2) return failure("fetch_failed", "Could not read robots.txt");
  const decision = await validatePublicUrl(robotsUrl.href, deps);
  if (!decision.ok) return decision;

  let response: Response;
  try {
    response = await deps.fetch(decision.url, {
      method: "GET",
      redirect: "manual",
      signal: deps.signal,
      headers: { "user-agent": deps.userAgent, accept: "text/plain" },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return failure("timeout", "Page exceeded the 30s limit");
    }
    return failure("fetch_failed", "Could not read robots.txt");
  }

  if (response.status === 404 || response.status === 410) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: true, groups: "allow" };
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: true, groups: "deny" };
  }
  if (response.status >= 500) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: true, groups: "allow" };
  }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location) return failure("fetch_failed", "Could not read robots.txt");
    const next = new URL(location, decision.url);
    const nextDecision = await validatePublicUrl(next.href, deps);
    if (!nextDecision.ok) return nextDecision;
    return readRobots(nextDecision.url, deps, depth + 1);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return failure("fetch_failed", "Could not read robots.txt");
  }

  const text = await readTextLimited(response, LIMITS.maxRobotsBytes);
  return { ok: true, groups: parseRobots(text) };
}

function isDocumentContentType(contentType: string): boolean {
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return mime === "text/html" || mime === "application/xhtml+xml" || mime === "text/plain";
}
