import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BrowserBusyError } from "../src/scan/errors";
import { scanPage, scanSite } from "../src/scan/scan";
import { depsFor, publicDns, scriptedFetch } from "./helpers";

const pages = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/pages");
const home = readFileSync(join(pages, "site-home.html"), "utf8");
const child = readFileSync(join(pages, "site-child.html"), "utf8");

function siteRoutes(): Record<string, { status?: number; body?: string; headers?: Record<string, string> }> {
  return {
    "https://example.com/robots.txt": { status: 404 },
    "https://example.com/": { body: home, headers: { "content-type": "text/html" } },
    "https://example.com/site-child.html": { body: child, headers: { "content-type": "text/html" } },
  };
}

describe("scan engine", () => {
  it("refuses to run unless authorized is true, before any fetch", async () => {
    const fetchImpl = scriptedFetch(siteRoutes());
    const outcome = await scanPage(
      { url: "https://example.com/", standard: "wcag22aa", authorized: false },
      depsFor(fetchImpl),
    );
    expect(outcome).toMatchObject({ ok: false, code: "unauthorized" });
    expect(fetchImpl.urls).toEqual([]);
  });

  it("rejects more than 10 pages before fetching", async () => {
    const fetchImpl = scriptedFetch(siteRoutes());
    const outcome = await scanSite(
      { start_url: "https://example.com/", max_pages: 11, authorized: true },
      depsFor(fetchImpl),
    );
    expect(outcome).toMatchObject({ ok: false, code: "invalid_input" });
    expect(fetchImpl.urls).toEqual([]);
  });

  it("scans a public page and records violations from the fixture", async () => {
    const fetchImpl = scriptedFetch(siteRoutes());
    const outcome = await scanPage(
      { url: "https://example.com/", authorized: true },
      depsFor(fetchImpl),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.standard).toBe("wcag22aa");
    expect(outcome.result.url).toBe("https://example.com/");
    const ids = outcome.result.violations.map((violation) => violation.ruleId);
    expect(ids).toContain("image-alt");
    expect(ids).toContain("html-has-lang");
    expect(fetchImpl.urls[0]).toBe("https://example.com/robots.txt");
  });

  it("refuses for free when robots.txt disallows the URL", async () => {
    const fetchImpl = scriptedFetch({
      "https://example.com/robots.txt": {
        body: "User-agent: *\nDisallow: /\n",
        headers: { "content-type": "text/plain" },
      },
      "https://example.com/": { body: home, headers: { "content-type": "text/html" } },
    });
    const outcome = await scanPage({ url: "https://example.com/", authorized: true }, depsFor(fetchImpl));
    expect(outcome).toMatchObject({ ok: false, code: "robots" });
    expect(fetchImpl.urls).toEqual(["https://example.com/robots.txt"]);
  });

  it("stays on the start origin and caps the crawl", async () => {
    const fetchImpl = scriptedFetch(siteRoutes());
    const outcome = await scanSite(
      { start_url: "https://example.com/", max_pages: 2, authorized: true },
      depsFor(fetchImpl),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.pagesScanned).toBe(2);
    expect(outcome.result.pages.map((page) => page.url)).toEqual([
      "https://example.com/",
      "https://example.com/site-child.html",
    ]);
    expect(fetchImpl.urls.some((url) => url.includes("other.example"))).toBe(false);
    const top = outcome.result.topIssues.map((issue) => issue.ruleId);
    expect(top).toContain("image-alt");
    expect(top).toContain("button-name");
  });

  it("does not fetch a second page when max_pages is 1", async () => {
    const fetchImpl = scriptedFetch(siteRoutes());
    const outcome = await scanSite(
      { start_url: "https://example.com/", max_pages: 1, authorized: true },
      depsFor(fetchImpl),
    );
    expect(outcome.ok).toBe(true);
    expect(fetchImpl.urls).not.toContain("https://example.com/site-child.html");
  });

  it("skips a later page that robots.txt disallows", async () => {
    const fetchImpl = scriptedFetch({
      "https://example.com/robots.txt": {
        body: "User-agent: *\nDisallow: /site-child.html\n",
        headers: { "content-type": "text/plain" },
      },
      "https://example.com/": { body: home, headers: { "content-type": "text/html" } },
      "https://example.com/site-child.html": { body: child, headers: { "content-type": "text/html" } },
    });
    const outcome = await scanSite(
      { start_url: "https://example.com/", max_pages: 2, authorized: true },
      depsFor(fetchImpl),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.pagesScanned).toBe(1);
    expect(outcome.result.skipped).toEqual([
      { url: "https://example.com/site-child.html", reason: "robots" },
    ]);
  });

  it("blocks a private redirect and maps browser capacity to an uncharged error", async () => {
    const redirected = scriptedFetch({
      "https://example.com/robots.txt": { status: 404 },
      "https://example.com/go": { status: 302, headers: { location: "http://169.254.169.254/latest" } },
    });
    const blocked = await scanPage({ url: "https://example.com/go", authorized: true }, depsFor(redirected));
    expect(blocked).toMatchObject({ ok: false, code: "ssrf" });

    const busyFetch = scriptedFetch({
      "https://example.com/robots.txt": { status: 404 },
      "https://example.com/": { body: home, headers: { "content-type": "text/html" } },
    });
    const busy = await scanPage(
      { url: "https://example.com/", authorized: true },
      {
        ...depsFor(busyFetch),
        auditHtml: async () => {
          throw new BrowserBusyError();
        },
      },
    );
    expect(busy).toMatchObject({ ok: false, code: "browser_busy" });
  });

  it("does not scan a hostname that resolves to a loopback address", async () => {
    const fetchImpl = scriptedFetch({
      "https://rebind.example/robots.txt": { status: 404 },
      "https://rebind.example/": { body: home },
    });
    const outcome = await scanPage(
      { url: "https://rebind.example/", authorized: true },
      depsFor(fetchImpl, publicDns({ "rebind.example": ["127.0.0.1"] })),
    );
    expect(outcome).toMatchObject({ ok: false, code: "ssrf" });
    expect(fetchImpl.urls).toEqual([]);
  });
});
