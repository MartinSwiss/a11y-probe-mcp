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
    expect(html).toContain("https://a11y.aiagentpay.cloud/mcp");
    expect(html).toContain('lang="en"');
    expect(html.toLowerCase()).not.toContain("axe");
  });

  it("drafts Swiss terms that cap liability at the amount paid", () => {
    const terms = page("legal/terms/index.html");
    expect(terms).toContain("Swiss law");
    expect(terms).toContain("capped at the amount paid");
    expect(terms).toContain("not legal advice");
    expect(terms).toContain("not a compliance guarantee");
    expect(terms).toContain("https://a11y.aiagentpay.cloud");
    expect(terms).toContain("Martin Ma");
    expect(terms).toContain("Bächlistrasse 18");
    expect(terms).toContain("kontakt@aiagentpay.cloud");
    expect(terms).toContain("Draft / Entwurf");
    expect(terms).not.toContain("[");
  });

  it("names Cloudflare and Coinbase as processors abroad under the nDSG", () => {
    const privacy = page("legal/privacy/index.html");
    expect(privacy).toContain("nDSG");
    expect(privacy).toContain("Cloudflare");
    expect(privacy).toContain("Coinbase");
    expect(privacy).toContain("United States");
    expect(privacy).toContain("SHA-256");
    expect(privacy).toContain("https://a11y.aiagentpay.cloud");
    expect(privacy).toContain("Martin Ma");
    expect(privacy).toContain("Verantwortlicher");
    expect(privacy).toContain("Bächlistrasse 18");
    expect(privacy).toContain("8805 Richterswil");
    expect(privacy).toContain("kontakt@aiagentpay.cloud");
    expect(privacy).toContain("Draft / Entwurf");
    expect(privacy).toContain("Page content");
  });

  it("names Martin Ma on the imprint and keeps the draft notice", () => {
    const imprint = page("legal/imprint/index.html");
    expect(imprint).toContain("Martin Ma");
    expect(imprint).toContain("Einzelperson");
    expect(imprint).toContain("Bächlistrasse 18");
    expect(imprint).toContain("8805 Richterswil");
    expect(imprint).toContain("Schweiz");
    expect(imprint).toContain("kontakt@aiagentpay.cloud");
    expect(imprint).toContain("nicht eingetragen");
    expect(imprint).toContain("MartinSwiss");
    expect(imprint).toContain("https://a11y.aiagentpay.cloud");
    expect(imprint).toContain("Draft / Entwurf");
    expect(imprint).not.toContain("[");
    expect(imprint.toLowerCase()).not.toContain("phone");
    expect(imprint).not.toContain("tel:");
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
    expect(manifest.remotes[0]?.url).toBe("https://a11y.aiagentpay.cloud/mcp");
    expect((manifest as { websiteUrl?: string }).websiteUrl).toBe("https://a11y.aiagentpay.cloud/");
  });
});
