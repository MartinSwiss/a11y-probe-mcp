/**
 * stdio entry for Glama and other local MCP hosts.
 * get_pricing is answered from this process. Paid tools are proxied to
 * A11Y_PROBE_URL and return the worker's 402 body when the caller has not paid.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getPricing, PRICES_USD, REPORT_LANGUAGES, STANDARDS } from "./config.ts";

const origin = process.env.A11Y_PROBE_URL?.replace(/\/$/, "");
const standard = z.enum(STANDARDS).optional();
const authorized = z.literal(true);

const server = new McpServer({ name: "a11y-probe-mcp", version: "0.1.0" });

server.registerTool(
  "get_pricing",
  {
    description: "Prices in USD, limits, and links to the terms and privacy notice. Free.",
    inputSchema: z.object({}),
  },
  async () => ({
    content: [{ type: "text", text: JSON.stringify(getPricing(origin ? { infoUrl: origin } : {})) }],
  }),
);

server.registerTool(
  "scan_page",
  {
    description: `Scan one public page. ${PRICES_USD.scan_page} USD via x402 when A11Y_PROBE_URL is set.`,
    inputSchema: z.object({ url: z.string().url(), standard, authorized }),
  },
  async (args) => proxy("/api/v1/scan/page", args),
);

server.registerTool(
  "scan_site",
  {
    description: `Scan up to 10 same-origin pages. ${PRICES_USD.scan_site} USD via x402 when A11Y_PROBE_URL is set.`,
    inputSchema: z.object({
      start_url: z.string().url(),
      max_pages: z.number().int().min(1).max(10).optional(),
      standard,
      authorized,
    }),
  },
  async (args) => proxy("/api/v1/scan/site", args),
);

server.registerTool(
  "report",
  {
    description: `Markdown report in de, fr, or en. ${PRICES_USD.report} USD via x402 when A11Y_PROBE_URL is set.`,
    inputSchema: z.object({
      start_url: z.string().url(),
      max_pages: z.number().int().min(1).max(10).optional(),
      standard,
      language: z.enum(REPORT_LANGUAGES).optional(),
      authorized,
    }),
  },
  async (args) => proxy("/api/v1/report", args),
);

async function proxy(path: string, body: unknown): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  if (!origin) {
    return {
      isError: true,
      content: [{ type: "text", text: "Set A11Y_PROBE_URL to the deployed Worker origin before calling a paid tool." }],
    };
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  const payment = process.env.PAYMENT_SIGNATURE;
  if (payment) headers["payment-signature"] = payment;
  let response: Response;
  try {
    response = await fetch(`${origin}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    return { isError: true, content: [{ type: "text", text: "The A11y Probe Worker could not be reached." }] };
  }
  const text = await response.text();
  if (response.status === 402 || !response.ok) {
    return { isError: true, content: [{ type: "text", text }] };
  }
  return { content: [{ type: "text", text }] };
}

const transport = new StdioServerTransport();
await server.connect(transport);
