/**
 * Prices, limits, and standards. This is the only file that sets what a
 * scan costs. The worker reads network and payee addresses from the
 * environment so those can change without editing this file.
 */

export const PRODUCT = {
  name: "A11y Probe",
  slug: "a11y-probe-mcp",
  version: "0.1.0",
  userAgentProduct: "A11yProbe",
} as const;

/** Placeholder until the owner sets the public info URL on the Worker. */
export const DEFAULT_INFO_URL = "https://a11y-probe.example/";

export function userAgent(infoUrl: string = DEFAULT_INFO_URL): string {
  return `${PRODUCT.userAgentProduct}/1.0 (+${infoUrl})`;
}

/** USD per call. get_pricing is free. */
export const PRICES_USD = {
  get_pricing: 0,
  scan_page: 0.05,
  scan_site: 0.5,
  report: 1,
} as const;

export type PaidToolName = keyof typeof PRICES_USD;

export const LIMITS = {
  pageTimeoutMs: 30_000,
  maxPagesPerCall: 10,
  maxRedirects: 5,
  callsPerMinute: 10,
  pagesPerDomainPerDay: 50,
  /**
   * Default global page budget. Browser Run's free tier includes 10 minutes
   * per day; 20 pages leaves headroom under a 30s page cap. Override with
   * GLOBAL_DAILY_PAGE_CAP on the Worker.
   */
  globalDailyPageCap: 20,
  snippetMaxChars: 200,
  selectorsPerViolation: 3,
  maxDocumentBytes: 2_000_000,
  maxRobotsBytes: 512_000,
} as const;

export const STANDARDS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] as const;
export type Standard = (typeof STANDARDS)[number];
export const DEFAULT_STANDARD: Standard = "wcag22aa";

export const COVERAGE_NOTE =
  "Automated checks find roughly 57% of WCAG issues.";

export const LEGAL_PATHS = {
  terms: "/legal/terms",
  privacy: "/legal/privacy",
  imprint: "/legal/imprint",
} as const;

export const REPORT_LANGUAGES = ["de", "fr", "en"] as const;
export type ReportLanguage = (typeof REPORT_LANGUAGES)[number];

export function tagsForStandard(standard: Standard): string[] {
  switch (standard) {
    case "wcag2a":
      return ["wcag2a"];
    case "wcag2aa":
      return ["wcag2a", "wcag2aa"];
    case "wcag21aa":
      return ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
    case "wcag22aa":
      return ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
  }
}

export interface Pricing {
  prices: typeof PRICES_USD;
  currency: "USD";
  limits: {
    pageTimeoutMs: number;
    maxPagesPerCall: number;
    callsPerMinute: number;
    pagesPerDomainPerDay: number;
    globalDailyPageCap: number;
    maxRedirects: number;
  };
  links: { terms: string; privacy: string; imprint: string };
  coverageNote: string;
  standards: readonly Standard[];
  defaultStandard: Standard;
  userAgent: string;
}

export function getPricing(options?: {
  infoUrl?: string;
  globalDailyPageCap?: number;
}): Pricing {
  const infoUrl = options?.infoUrl ?? DEFAULT_INFO_URL;
  return {
    prices: PRICES_USD,
    currency: "USD",
    limits: {
      pageTimeoutMs: LIMITS.pageTimeoutMs,
      maxPagesPerCall: LIMITS.maxPagesPerCall,
      callsPerMinute: LIMITS.callsPerMinute,
      pagesPerDomainPerDay: LIMITS.pagesPerDomainPerDay,
      globalDailyPageCap: options?.globalDailyPageCap ?? LIMITS.globalDailyPageCap,
      maxRedirects: LIMITS.maxRedirects,
    },
    links: {
      terms: new URL(LEGAL_PATHS.terms, infoUrl).href,
      privacy: new URL(LEGAL_PATHS.privacy, infoUrl).href,
      imprint: new URL(LEGAL_PATHS.imprint, infoUrl).href,
    },
    coverageNote: COVERAGE_NOTE,
    standards: STANDARDS,
    defaultStandard: DEFAULT_STANDARD,
    userAgent: userAgent(infoUrl),
  };
}
