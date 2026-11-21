import { describe, expect, it } from "vitest";
import { COVERAGE_NOTE, DEFAULT_INFO_URL, getPricing, LIMITS, PRICES_USD, userAgent } from "../src/config";

describe("pricing", () => {
  it("keeps the published prices in one config object", () => {
    expect(PRICES_USD).toEqual({
      get_pricing: 0,
      check_contrast: 0.01,
      scan_page: 0.05,
      check_links_meta: 0.05,
      scan_site: 0.5,
      report: 1,
    });
  });

  it("describes limits, legal links, and the coverage note", () => {
    const pricing = getPricing({ infoUrl: "https://a11y-probe.example/" });
    expect(pricing.currency).toBe("USD");
    expect(pricing.prices.scan_page).toBe(0.05);
    expect(pricing.coverageNote).toBe(COVERAGE_NOTE);
    expect(pricing.coverageNote).toContain("57%");
    expect(pricing.limits).toMatchObject({
      pageTimeoutMs: LIMITS.pageTimeoutMs,
      maxPagesPerCall: 10,
      callsPerMinute: 10,
      pagesPerDomainPerDay: 50,
      globalDailyPageCap: 20,
      maxRedirects: 5,
    });
    expect(pricing.links.terms).toBe("https://a11y-probe.example/legal/terms");
    expect(pricing.links.privacy).toBe("https://a11y-probe.example/legal/privacy");
    expect(pricing.defaultStandard).toBe("wcag22aa");
    expect(pricing.userAgent).toBe("A11yProbe/1.0 (+https://a11y-probe.example/)");
    expect(DEFAULT_INFO_URL).toBe("https://a11y.aiagentpay.cloud/");
    expect(userAgent()).toBe("A11yProbe/1.0 (+https://a11y.aiagentpay.cloud/)");
  });
});
