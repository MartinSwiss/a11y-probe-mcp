import { LIMITS } from "../config";
import { fetchPublicDocument, type DocumentDeps } from "../scan/fetch-document";
import { validatePublicUrl, type GuardDeps } from "../scan/ssrf";
import { normaliseUrl } from "../scan/url";

const MAX_LINKS = 50;
const LINK_CONCURRENCY = 4;
const LINK_TIMEOUT_MS = 10_000;

export interface LinkCheck {
  href: string;
  status: number | null;
  broken: boolean;
  blocked: boolean;
}

export interface LinksMetaResult {
  url: string;
  title: string;
  metaDescription: string;
  metaDescriptionLength: number;
  lang: string;
  viewport: string;
  canonical: string;
  h1Count: number;
  ogTitle: string;
  ogDescription: string;
  linksChecked: number;
  links: LinkCheck[];
}

type LinkDeps = DocumentDeps & GuardDeps;

/**
 * Read one public page with fetch (not Browser Run) and check up to 50 links
 * found on that page. Link targets are not crawled for further links.
 */
export async function checkLinksMeta(
  input: string,
  deps: LinkDeps,
): Promise<{ ok: true; result: LinksMetaResult } | { ok: false; code: string; message: string }> {
  const document = await fetchPublicDocument(input, deps);
  if (!document.ok) return document;
  const meta = readMeta(document.html, document.url);
  const links = await mapLimit(meta.hrefs, LINK_CONCURRENCY, (href) => checkLink(href, deps));
  return {
    ok: true,
    result: {
      url: document.url.href,
      title: meta.title,
      metaDescription: meta.metaDescription,
      metaDescriptionLength: meta.metaDescription.length,
      lang: meta.lang,
      viewport: meta.viewport,
      canonical: meta.canonical,
      h1Count: meta.h1Count,
      ogTitle: meta.ogTitle,
      ogDescription: meta.ogDescription,
      linksChecked: links.length,
      links,
    },
  };
}

async function checkLink(href: string, deps: LinkDeps): Promise<LinkCheck> {
  const shape = await validatePublicUrl(href, deps);
  if (!shape.ok) return { href, status: null, broken: false, blocked: true };
  const head = await request(shape.url.href, "HEAD", deps, 0);
  if (head.kind === "status" && head.status !== 405 && head.status !== 501) {
    return { href, status: head.status, broken: head.status >= 400, blocked: false };
  }
  if (head.kind === "blocked") return { href, status: null, broken: false, blocked: true };
  const get = await request(shape.url.href, "GET", deps, 0);
  if (get.kind === "blocked") return { href, status: null, broken: false, blocked: true };
  if (get.kind === "timeout") return { href, status: null, broken: true, blocked: false };
  if (get.kind === "network") return { href, status: null, broken: true, blocked: false };
  return { href, status: get.status, broken: get.status >= 400, blocked: false };
}

type Hop = { kind: "status"; status: number } | { kind: "timeout" } | { kind: "network" } | { kind: "blocked" };

async function request(input: string, method: "GET" | "HEAD", deps: LinkDeps, hop: number): Promise<Hop> {
  if (hop > LIMITS.maxRedirects) return { kind: "blocked" };
  const decision = await validatePublicUrl(input, deps);
  if (!decision.ok) return { kind: "blocked" };
  const signal = AbortSignal.timeout(LINK_TIMEOUT_MS);
  let response: Response;
  try {
    response = await deps.fetch(decision.url, {
      method,
      redirect: "manual",
      signal,
      headers: { "user-agent": deps.userAgent, accept: "*/*" },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { kind: "timeout" };
    return { kind: "network" };
  }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location) return { kind: "status", status: response.status };
    const next = normaliseUrl(location, decision.url.href);
    if (!next.ok) return { kind: "blocked" };
    return request(next.url.href, method, deps, hop + 1);
  }
  await response.body?.cancel().catch(() => undefined);
  return { kind: "status", status: response.status };
}

function readMeta(html: string, page: URL): {
  title: string;
  metaDescription: string;
  lang: string;
  viewport: string;
  canonical: string;
  h1Count: number;
  ogTitle: string;
  ogDescription: string;
  hrefs: string[];
} {
  const lang = attr(html.match(/<html\b[^>]*>/i)?.[0] ?? "", "lang");
  const title = text(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const metaDescription = metaContent(html, "description");
  const viewport = metaContent(html, "viewport");
  const canonical = linkHref(html, "canonical");
  const h1Count = html.match(/<h1\b/gi)?.length ?? 0;
  const ogTitle = metaProperty(html, "og:title");
  const ogDescription = metaProperty(html, "og:description");
  const hrefs: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    const parsed = normaliseUrl(decode(raw), page.href);
    if (!parsed.ok) continue;
    if (parsed.url.protocol !== "http:" && parsed.url.protocol !== "https:") continue;
    if (seen.has(parsed.url.href)) continue;
    seen.add(parsed.url.href);
    hrefs.push(parsed.url.href);
    if (hrefs.length === MAX_LINKS) break;
  }
  return { title, metaDescription, lang, viewport, canonical, h1Count, ogTitle, ogDescription, hrefs };
}

function metaContent(html: string, name: string): string {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const raw = tag[0] ?? "";
    if (attr(raw, "name").toLowerCase() !== name) continue;
    return attr(raw, "content");
  }
  return "";
}

function metaProperty(html: string, property: string): string {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const raw = tag[0] ?? "";
    if (attr(raw, "property").toLowerCase() !== property) continue;
    return attr(raw, "content");
  }
  return "";
}

function linkHref(html: string, rel: string): string {
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const raw = tag[0] ?? "";
    const tokens = attr(raw, "rel").toLowerCase().split(/\s+/);
    if (!tokens.includes(rel)) continue;
    return attr(raw, "href");
  }
  return "";
}

function attr(tag: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return decode(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function text(value: string): string {
  return decode(value).replace(/\s+/g, " ").trim();
}

function decode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
