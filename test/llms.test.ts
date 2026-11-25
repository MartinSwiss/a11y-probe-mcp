import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRICES_USD } from "../src/config";
import {
  contrastDescription,
  linksDescription,
  pageDescription,
  pricingDescription,
  reportDescription,
  siteDescription,
} from "../src/payments/bazaar";

describe("llms.txt", () => {
  const text = readFileSync(new URL("../public/llms.txt", import.meta.url), "utf8");

  it("follows the llms.txt heading shape and lists the live origin", () => {
    expect(text.startsWith("# A11y Probe\n")).toBe(true);
    expect(text).toContain("> Automated WCAG accessibility scans for AI agents, paid per call with x402 USDC on Base mainnet.");
    expect(text).toContain("## Tools");
    expect(text).toContain("## Repository");
    expect(text).toContain("https://a11y.aiagentpay.cloud/mcp");
    expect(text).toContain("https://a11y.aiagentpay.cloud/api/v1/");
    expect(text).toContain("https://github.com/MartinSwiss/a11y-probe-mcp");
    expect(text).toContain("57%");
    expect(text).toContain("not legal advice, no compliance guarantee");
  });

  it("lists every tool at the price in src/config.ts", () => {
    expect(text).toContain("get_pricing");
    expect(text).toContain("Free (0 USD)");
    expect(PRICES_USD.get_pricing).toBe(0);
    expect(text).toContain(`scan_page](https://a11y.aiagentpay.cloud/api/v1/scan/page): ${PRICES_USD.scan_page.toFixed(2)} USD`);
    expect(text).toContain(`scan_site](https://a11y.aiagentpay.cloud/api/v1/scan/site): ${PRICES_USD.scan_site.toFixed(2)} USD`);
    expect(text).toContain(`report](https://a11y.aiagentpay.cloud/api/v1/report): ${PRICES_USD.report.toFixed(2)} USD`);
    expect(text).toContain(`check_contrast](https://a11y.aiagentpay.cloud/api/v1/check/contrast): ${PRICES_USD.check_contrast.toFixed(2)} USD`);
    expect(text).toContain(
      `check_links_meta](https://a11y.aiagentpay.cloud/api/v1/check/links-meta): ${PRICES_USD.check_links_meta.toFixed(2)} USD`,
    );
  });
});

describe("tool descriptions", () => {
  it("starts with the terms a caller would search for", () => {
    expect(pricingDescription().startsWith("Pricing for WCAG accessibility scans.")).toBe(true);
    expect(pageDescription().startsWith("WCAG 2.2 accessibility audit of one public web page.")).toBe(true);
    expect(siteDescription().startsWith("WCAG 2.2 accessibility audit of up to 10 same-origin pages")).toBe(true);
    expect(reportDescription().startsWith("WCAG accessibility report in Markdown")).toBe(true);
    expect(contrastDescription().startsWith("Color contrast check (WCAG 2.2 AA/AAA)")).toBe(true);
    expect(linksDescription().startsWith("Broken links and meta tag check")).toBe(true);
    for (const text of [pricingDescription(), pageDescription(), siteDescription(), reportDescription(), contrastDescription(), linksDescription()]) {
      expect(text.length).toBeLessThanOrEqual(500);
    }
  });
});
