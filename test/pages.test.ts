import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function page(path: string): string {
  return readFileSync(new URL(`../public/${path}`, import.meta.url), "utf8");
}

describe("public pages", () => {
  it("states the prices, the payment flow, and the limits", () => {
    const html = page("index.html");
    expect(html).toContain("0.05");
    expect(html).toContain("0.50");
    expect(html).toContain("1.00");
    expect(html).toContain("57%");
    expect(html).toContain("402");
    expect(html).toContain("PAYMENT-SIGNATURE");
    expect(html).toContain("10 paid calls");
    expect(html).toContain("50 pages");
    expect(html).toContain('lang="en"');
    expect(html.toLowerCase()).not.toContain("axe");
  });

  it("drafts Swiss terms that cap liability at the amount paid", () => {
    const terms = page("legal/terms/index.html");
    expect(terms).toContain("Swiss law");
    expect(terms).toContain("capped at the amount paid");
    expect(terms).toContain("not legal advice");
    expect(terms).toContain("not a compliance guarantee");
    expect(terms).toContain("Draft");
  });

  it("names Cloudflare and Coinbase as processors abroad under the nDSG", () => {
    const privacy = page("legal/privacy/index.html");
    expect(privacy).toContain("nDSG");
    expect(privacy).toContain("Cloudflare");
    expect(privacy).toContain("Coinbase");
    expect(privacy).toContain("United States");
    expect(privacy).toContain("SHA-256");
    expect(privacy).toContain("Page content");
  });

  it("leaves imprint fields as placeholders", () => {
    const imprint = page("legal/imprint/index.html");
    expect(imprint).toContain("[Legal name]");
    expect(imprint).toContain("[Street and number]");
    expect(imprint).toContain("MartinSwiss");
    expect(imprint).toContain("placeholders");
  });
});

describe("registry manifest", () => {
  it("uses the owner's GitHub namespace", () => {
    const manifest = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8")) as {
      name: string;
      description: string;
      remotes: Array<{ type: string; url: string }>;
    };
    expect(manifest.name).toBe("io.github.MartinSwiss/a11y-probe-mcp");
    expect(manifest.description.length).toBeGreaterThan(0);
    expect(manifest.description.length).toBeLessThanOrEqual(100);
    expect(manifest.remotes[0]?.type).toBe("streamable-http");
    expect(manifest.remotes[0]?.url).toContain("/mcp");
  });
});
