import { describe, expect, it } from "vitest";
import { normaliseUrl, sameOrigin } from "../src/scan/url";

describe("URL normalisation", () => {
  it("lower-cases the host, drops the fragment, and drops default ports", () => {
    const https = normaliseUrl("https://Example.COM:443/a/b#token");
    expect(https.ok).toBe(true);
    if (https.ok) expect(https.url.href).toBe("https://example.com/a/b");

    const http = normaliseUrl("http://Example.com:80/a/");
    expect(http.ok).toBe(true);
    if (http.ok) expect(http.url.href).toBe("http://example.com/a/");
  });

  it("strips a trailing dot and resolves relative redirects against the current hop", () => {
    const dotted = normaliseUrl("https://example.com./docs");
    expect(dotted.ok).toBe(true);
    if (dotted.ok) expect(dotted.url.href).toBe("https://example.com/docs");

    const relative = normaliseUrl("../secret", "https://example.com/app/page");
    expect(relative.ok).toBe(true);
    if (relative.ok) expect(relative.url.href).toBe("https://example.com/secret");
  });

  it("rejects credentials and unparseable input", () => {
    expect(normaliseUrl("https://user:secret@example.com/")).toMatchObject({
      ok: false,
      message: "URLs with credentials are not allowed",
    });
    expect(normaliseUrl("not a url").ok).toBe(false);
    expect(normaliseUrl("").ok).toBe(false);
  });

  it("compares origins after normalisation", () => {
    const a = normaliseUrl("https://example.com:443/a");
    const b = normaliseUrl("https://example.com/b");
    const c = normaliseUrl("https://example.com:8443/c");
    const d = normaliseUrl("http://example.com/d");
    if (!a.ok || !b.ok || !c.ok || !d.ok) throw new Error("expected urls to parse");
    expect(sameOrigin(a.url, b.url)).toBe(true);
    expect(sameOrigin(a.url, c.url)).toBe(false);
    expect(sameOrigin(a.url, d.url)).toBe(false);
  });
});
