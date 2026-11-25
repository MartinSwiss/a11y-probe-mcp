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
    description: "True when the caller may scan this URL.",
  },
};

const pageExample = { url: "https://example.com/", standard: "wcag22aa", authorized: true };
const siteExample = { start_url: "https://example.com/", max_pages: 1, standard: "wcag22aa", authorized: true };
const reportExample = { start_url: "https://example.com/", max_pages: 1, language: "en", authorized: true };
const contrastExample = { pairs: [{ foreground: "#767676", background: "#ffffff" }], fontSizePx: 16 };
const linksExample = { url: "https://example.com/", authorized: true };

const contrastProperties = {
  pairs: {
    type: "array",
    maxItems: 50,
    items: {
      type: "object",
      properties: {
        foreground: { type: "string", description: "CSS color: hex, rgb, hsl, or a CSS color name." },
        background: { type: "string", description: "CSS color: hex, rgb, hsl, or a CSS color name." },
        fontSizePx: { type: "number", description: "Font size in CSS pixels for this pair." },
        bold: { type: "boolean", description: "True when this pair is bold." },
      },
      required: ["foreground", "background"],
    },
  },
  fontSizePx: { type: "number", description: "Default font size in CSS pixels." },
  bold: { type: "boolean", description: "True when the default text is bold." },
};

export function bazaarForTool(tool: keyof typeof PRICES_USD): Record<string, unknown> {
  if (tool === "get_pricing") return {};
  if (tool === "check_contrast") {
    return declareDiscoveryExtension({
      toolName: "check_contrast",
      description: contrastDescription(),
      inputSchema: { type: "object", properties: contrastProperties, required: ["pairs"] },
      example: contrastExample,
      output: {
        example: {
          pairs: [{ ratio: 4.54, aa: { normal: true, large: true }, aaa: { normal: false, large: true }, nonText: true, suggestion: null }],
        },
        schema: contrastOutputSchema,
      },
    });
  }
  if (tool === "check_links_meta") {
    return declareDiscoveryExtension({
      toolName: "check_links_meta",
      description: linksDescription(),
      inputSchema: {
        type: "object",
        properties: {
          url: pageProperties.url,
          authorized: pageProperties.authorized,
        },
        required: ["url", "authorized"],
      },
      example: linksExample,
      output: {
        example: { title: "Example Domain", h1Count: 1, linksChecked: 1, links: [{ href: "https://example.com/", status: 200, broken: false }] },
        schema: linksOutputSchema,
      },
    });
  }
  if (tool === "scan_page") {
    return declareDiscoveryExtension({
      toolName: "scan_page",
      description: pageDescription(),
      inputSchema: {
        type: "object",
        properties: pageProperties,
        required: ["url", "authorized"],
      },
      example: pageExample,
      output: {
        example: {
          summary: { critical: 1, serious: 0, moderate: 0, minor: 0 },
          violations: [{ ruleId: "image-alt", impact: "critical", nodeCount: 1 }],
        },
        schema: pageOutputSchema,
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
      example: siteExample,
      output: {
        example: { pagesScanned: 1, topIssues: [{ ruleId: "image-alt", impact: "critical" }] },
        schema: siteOutputSchema,
      },
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
    example: reportExample,
    output: {
      example: { markdown: "# Accessibility scan report\n\nnot legal advice, no compliance guarantee\n" },
      schema: reportOutputSchema,
    },
  });
}

export function bazaarForHttp(path: string): Record<string, unknown> {
  if (path.endsWith("/check/contrast")) {
    return declareDiscoveryExtension({
      bodyType: "json",
      input: contrastExample,
      inputSchema: { type: "object", properties: contrastProperties, required: ["pairs"] },
      output: {
        example: { pairs: [{ ratio: 4.54, nonText: true, suggestion: null }] },
        schema: contrastOutputSchema,
      },
    });
  }
  if (path.endsWith("/check/links-meta")) {
    return declareDiscoveryExtension({
      bodyType: "json",
      input: linksExample,
      inputSchema: {
        type: "object",
        properties: { url: pageProperties.url, authorized: pageProperties.authorized },
        required: ["url", "authorized"],
      },
      output: {
        example: { title: "Example Domain", metaDescriptionLength: 0, h1Count: 1, linksChecked: 0, links: [] },
        schema: linksOutputSchema,
      },
    });
  }
  if (path.endsWith("/scan/page")) {
    return declareDiscoveryExtension({
      bodyType: "json",
      input: pageExample,
      inputSchema: { type: "object", properties: pageProperties, required: ["url", "authorized"] },
      output: {
        example: { summary: { critical: 0, serious: 0, moderate: 0, minor: 0 }, violations: [] },
        schema: pageOutputSchema,
      },
    });
  }
  if (path.endsWith("/scan/site")) {
    return declareDiscoveryExtension({
      bodyType: "json",
      input: siteExample,
      inputSchema: {
        type: "object",
        properties: {
          start_url: { type: "string", description: "Public page where the scan starts. Later pages stay on this origin." },
          max_pages: { type: "integer", minimum: 1, maximum: 10, description: "Page count, at most 10." },
          standard: standardSchema,
          authorized: pageProperties.authorized,
        },
        required: ["start_url", "authorized"],
      },
      output: {
        example: { pagesScanned: 1, topIssues: [] },
        schema: siteOutputSchema,
      },
    });
  }
  return declareDiscoveryExtension({
    bodyType: "json",
    input: reportExample,
    inputSchema: {
      type: "object",
      properties: {
        start_url: { type: "string", description: "Public page where the scan starts. Later pages stay on this origin." },
        max_pages: { type: "integer", minimum: 1, maximum: 10, description: "Page count, at most 10." },
        language: { type: "string", enum: ["de", "fr", "en"], description: "Report language. The default is en." },
        standard: standardSchema,
        authorized: pageProperties.authorized,
      },
      required: ["start_url", "authorized"],
    },
    output: {
      example: { markdown: "not legal advice, no compliance guarantee" },
      schema: reportOutputSchema,
    },
  });
}

const contrastOutputSchema = {
  properties: {
    pairs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ratio: { type: "number", description: "Contrast ratio." },
          nonText: { type: "boolean", description: "True when the ratio is at least 3:1." },
          suggestion: { description: "Nearer foreground hex, or null when AA is already met." },
        },
      },
    },
  },
};

const linksOutputSchema = {
  properties: {
    title: { type: "string" },
    metaDescriptionLength: { type: "integer" },
    h1Count: { type: "integer" },
    linksChecked: { type: "integer" },
    links: { type: "array" },
  },
};

const pageOutputSchema = {
  properties: {
    summary: { type: "object" },
    violations: { type: "array" },
  },
};

const siteOutputSchema = {
  properties: {
    pagesScanned: { type: "integer" },
    topIssues: { type: "array" },
  },
};

const reportOutputSchema = {
  properties: {
    markdown: { type: "string" },
  },
};

export function pricingDescription(): string {
  return "Pricing for WCAG accessibility scans. Prices in USD, rate and daily limits, and links to the terms and privacy notice. Automated checks find roughly 57% of WCAG issues. Free.";
}

export function contrastDescription(): string {
  return "Color contrast check (WCAG 2.2 AA/AAA) for up to 50 caller-supplied color pairs. No page is fetched. Each pair reports the contrast ratio, AA and AAA for normal and large text, the 3:1 non-text result, and a nearer foreground of the same hue when AA is not met. Price 0.01 USD in USDC on Base, settled after a successful check.";
}

export function linksDescription(): string {
  return "Broken links and meta tag check for one public page. Reports title, meta description and its length, html lang, viewport, canonical, h1 count, og:title, and og:description, then checks up to 50 links on that page. authorized is true. No further pages are crawled. Price 0.05 USD in USDC on Base, settled after a successful check.";
}

export function pageDescription(): string {
  return "WCAG 2.2 accessibility audit of one public web page. Returns rule ids, impact, WCAG tags, and up to three selectors. Default standard wcag22aa. authorized is true. No login, cookies, or stored page content. Price 0.05 USD in USDC on Base, settled after a successful scan. Automated checks find roughly 57% of WCAG issues.";
}

export function siteDescription(): string {
  return "WCAG 2.2 accessibility audit of up to 10 same-origin pages, starting from start_url. Returns rule ids, impact, and the top issues. authorized is true. Price 0.50 USD in USDC on Base, settled after a successful scan. Automated checks find roughly 57% of WCAG issues.";
}

export function reportDescription(): string {
  return "WCAG accessibility report in Markdown (de, fr, or en) from a same-origin scan of up to 10 pages, with a prioritised fix list. Not legal advice and no compliance guarantee. No model calls. Price 1.00 USD in USDC on Base, settled after a successful scan.";
}
