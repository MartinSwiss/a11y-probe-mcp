/**
 * Canonical URL form used before the SSRF checks and for same-origin compares.
 * Hosts are lower-case, fragments and default ports are removed, and trailing
 * dots on DNS names are stripped. Credentials fail closed.
 */

export type NormaliseResult =
  | { ok: true; url: URL }
  | { ok: false; message: string };

export function normaliseUrl(input: string, base?: string): NormaliseResult {
  if (typeof input !== "string" || input.trim() === "") {
    return { ok: false, message: "URL is empty" };
  }
  let url: URL;
  try {
    url = base ? new URL(input, base) : new URL(input);
  } catch {
    return { ok: false, message: "URL could not be parsed" };
  }

  if (url.username !== "" || url.password !== "") {
    return { ok: false, message: "URLs with credentials are not allowed" };
  }

  url.hash = "";

  if (url.hostname.endsWith(".")) {
    try {
      url.hostname = url.hostname.slice(0, -1);
    } catch {
      return { ok: false, message: "URL host is not allowed" };
    }
  }

  if (url.protocol === "http:" && url.port === "80") url.port = "";
  if (url.protocol === "https:" && url.port === "443") url.port = "";

  return { ok: true, url };
}

export function sameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.host === b.host;
}

export function originKey(url: URL): string {
  return `${url.protocol}//${url.host}`;
}
