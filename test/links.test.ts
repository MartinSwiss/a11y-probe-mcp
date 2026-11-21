import { describe, expect, it } from "vitest";
import { checkLinksMeta } from "../src/check/links";
import { UA, publicDns } from "./helpers";

const html = `<!doctype html>
<html lang="en">
  <head>
    <title>Example &amp; Co</title>
    <meta name="description" content="A short description">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="canonical" href="https://example.com/">
    <meta property="og:title" content="OG title">
    <meta property="og:description" content="OG text">
  </head>
  <body>
    <h1>One</h1>
    <h1>Two</h1>
    <a href="https://example.com/ok">ok</a>
    <a href="https://example.com/missing">missing</a>
    <a href="http://127.0.0.1/secret">secret</a>
    <a href="https://example.com/ok">duplicate</a>
    <a href="mailto:a@example.com">mail</a>
  </body>
</html>`;

describe("link and meta check", () => {
  it("reads the page and does not fetch a private link", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      urls.push(url);
      if (url === "https://example.com/robots.txt") return new Response("missing", { status: 404 });
      if (url === "https://example.com/" && (init?.method ?? "GET") === "GET") {
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url === "https://example.com/ok") return new Response("", { status: 200 });
      if (url === "https://example.com/missing") return new Response("", { status: 404 });
      return new Response("unexpected", { status: 500 });
    };
    const outcome = await checkLinksMeta("https://example.com/", {
      fetch: fetchImpl,
      resolveAddresses: publicDns(),
      userAgent: UA,
      signal: AbortSignal.timeout(5_000),
    });
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.result.title).toBe("Example & Co");
    expect(outcome.result.metaDescription).toBe("A short description");
    expect(outcome.result.metaDescriptionLength).toBe("A short description".length);
    expect(outcome.result.lang).toBe("en");
    expect(outcome.result.viewport).toContain("width=device-width");
    expect(outcome.result.canonical).toBe("https://example.com/");
    expect(outcome.result.h1Count).toBe(2);
    expect(outcome.result.ogTitle).toBe("OG title");
    expect(outcome.result.ogDescription).toBe("OG text");
    expect(outcome.result.linksChecked).toBe(3);
    expect(outcome.result.links.find((link) => link.href === "https://example.com/ok")).toMatchObject({ broken: false, status: 200 });
    expect(outcome.result.links.find((link) => link.href === "https://example.com/missing")).toMatchObject({ broken: true, status: 404 });
    expect(outcome.result.links.find((link) => link.href.startsWith("http://127.0.0.1"))).toMatchObject({ blocked: true, broken: false });
    expect(urls.some((url) => url.includes("127.0.0.1"))).toBe(false);
  });
});
