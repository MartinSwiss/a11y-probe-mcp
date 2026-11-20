import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { PRICES_USD } from "../config";

const standardSchema = {
  type: "string",
  enum: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
  description: "WCAG conformance target. Defaults to wcag22aa.",
};

const pageProperties = {
  url: { type: "string", description: "Public http or https URL." },
  standard: standardSchema,
  authorized: {
    type: "boolean",
    const: true,
    description: "Must be true. Confirms the caller is allowed to scan this URL.",
  },
};

export function bazaarForTool(tool: keyof typeof PRICES_USD): Record<string, unknown> {
  if (tool === "get_pricing") return {};
  if (tool === "scan_page") {
    return declareDiscoveryExtension({
      toolName: "scan_page",
      description: pageDescription(),
      inputSchema: {
        type: "object",
        properties: pageProperties,
        required: ["url", "authorized"],
      },
      output: {
        example: {
          summary: { critical: 1, serious: 0, moderate: 0, minor: 0 },
          violations: [{ ruleId: "image-alt", impact: "critical", nodeCount: 1 }],
        },
      },
    });
  }
  const siteProperties = {
    start_url: { type: "string", description: "Public page to start from. Later pages stay on this origin." },
    max_pages: { type: "integer", minimum: 1, maximum: 10, description: "Pages to scan, at most 10." },
    standard: standardSchema,
    authorized: pageProperties.authorized,
  };
  if (tool === "scan_site") {
    return declareDiscoveryExtension({
      toolName: "scan_site",
      description: siteDescription(),
      inputSchema: {
        type: "object",
        properties: siteProperties,
        required: ["start_url", "authorized"],
      },
      output: { example: { pagesScanned: 1, topIssues: [{ ruleId: "image-alt", impact: "critical" }] } },
    });
  }
  return declareDiscoveryExtension({
    toolName: "report",
    description: reportDescription(),
    inputSchema: {
      type: "object",
      properties: {
        ...siteProperties,
        language: { type: "string", enum: ["de", "fr", "en"], description: "Report language. Defaults to en." },
      },
      required: ["start_url", "authorized"],
    },
    output: { example: { markdown: "# Accessibility scan report\n\nnot legal advice, no compliance guarantee\n" } },
  });
}

export function bazaarForHttp(path: string): Record<string, unknown> {
  if (path.endsWith("/scan/page")) {
    return declareDiscoveryExtension({
      bodyType: "json",
      input: { url: "https://example.com/", standard: "wcag22aa", authorized: true },
      inputSchema: { properties: pageProperties, required: ["url", "authorized"] },
      output: { example: { summary: { critical: 0, serious: 0, moderate: 0, minor: 0 }, violations: [] } },
    });
  }
  if (path.endsWith("/scan/site")) {
    return declareDiscoveryExtension({
      bodyType: "json",
      input: { start_url: "https://example.com/", max_pages: 3, standard: "wcag22aa", authorized: true },
      inputSchema: {
        properties: {
          start_url: { type: "string" },
          max_pages: { type: "integer" },
          standard: standardSchema,
          authorized: pageProperties.authorized,
        },
        required: ["start_url", "authorized"],
      },
      output: { example: { pagesScanned: 1, topIssues: [] } },
    });
  }
  return declareDiscoveryExtension({
    bodyType: "json",
    input: { start_url: "https://example.com/", max_pages: 3, language: "en", authorized: true },
    inputSchema: {
      properties: {
        start_url: { type: "string" },
        max_pages: { type: "integer" },
        language: { type: "string", enum: ["de", "fr", "en"] },
        standard: standardSchema,
        authorized: pageProperties.authorized,
      },
      required: ["start_url", "authorized"],
    },
    output: { example: { markdown: "not legal advice, no compliance guarantee" } },
  });
}

export function pageDescription(): string {
  return "Scan one public page for WCAG issues. Requires authorized true. No login, cookies, or stored page content. 0.05 USD via USDC on Base, settled only after a successful scan. Automated checks find roughly 57% of WCAG issues.";
}

export function siteDescription(): string {
  return "Scan up to 10 same-origin pages starting from start_url. Requires authorized true. 0.50 USD via USDC on Base, settled only after a successful scan. Automated checks find roughly 57% of WCAG issues.";
}

export function reportDescription(): string {
  return "Write a template Markdown accessibility report in de, fr, or en with a prioritised fix list. Not legal advice and no compliance guarantee. No model calls. 1.00 USD via USDC on Base, settled only after a successful scan.";
}
