import { normaliseUrl, sameOrigin } from "./url";

const HREF =
  /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;

/** Same-origin http(s) links, fragments removed, duplicates dropped. */
export function extractLinks(html: string, base: URL): URL[] {
  const links: URL[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(HREF)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (raw === "" || raw.startsWith("#")) continue;
    if (/^(javascript|mailto|data|tel|sms):/i.test(raw)) continue;
    const normalised = normaliseUrl(raw, base.href);
    if (!normalised.ok) continue;
    if (normalised.url.protocol !== "http:" && normalised.url.protocol !== "https:") continue;
    if (!sameOrigin(normalised.url, base)) continue;
    if (seen.has(normalised.url.href)) continue;
    seen.add(normalised.url.href);
    links.push(normalised.url);
  }
  return links;
}
