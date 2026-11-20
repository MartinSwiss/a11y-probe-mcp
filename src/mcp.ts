import { McpServer } from "@modelcontextprotocol/server";
import { withX402 } from "agents/x402";
import { z } from "zod";
import { getPricing, PRICES_USD, REPORT_LANGUAGES, STANDARDS } from "./config";
import { facilitatorConfigFor, payToAddress } from "./payments/facilitator";
import { pageDescription, reportDescription, siteDescription } from "./payments/bazaar";
import { buildReport } from "./scan/report";
import { scanPage, scanSite, type ScanDeps } from "./scan/scan";

const standard = z.enum(STANDARDS).optional();
const authorized = z.literal(true).describe("Must be true. Confirms you may scan this URL.");

export function createMcpServer(env: Env, deps: ScanDeps): McpServer {
  const payTo = payToAddress(env.PAY_TO) ?? "0x0000000000000000000000000000000000000000";
  const server = withX402(new McpServer({ name: "a11y-probe-mcp", version: "0.1.0" }), {
    network: env.X402_NETWORK,
    recipient: payTo,
    facilitator: facilitatorConfigFor(env),
  });

  server.registerTool(
    "get_pricing",
    {
      description:
        "Prices in USD, rate and daily limits, and links to the terms and privacy notice. Automated checks find roughly 57% of WCAG issues. Free.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(getPricing({ infoUrl: env.INFO_URL, globalDailyPageCap: Number(env.GLOBAL_DAILY_PAGE_CAP) })),
        },
      ],
    }),
  );

  server.paidTool(
    "scan_page",
    pageDescription(),
    PRICES_USD.scan_page,
    {
      url: z.string().url().describe("Public http or https URL."),
      standard,
      authorized,
    },
    { readOnlyHint: true },
    async (args) => {
      const outcome = await scanPage(
        { url: args.url, authorized: true, ...(args.standard ? { standard: args.standard } : {}) },
        deps,
      );
      return toolResult(outcome);
    },
  );

  server.paidTool(
    "scan_site",
    siteDescription(),
    PRICES_USD.scan_site,
    {
      start_url: z.string().url(),
      max_pages: z.number().int().min(1).max(10).optional(),
      standard,
      authorized,
    },
    { readOnlyHint: true },
    async (args) => {
      const outcome = await scanSite(
        {
          start_url: args.start_url,
          authorized: true,
          ...(args.max_pages !== undefined ? { max_pages: args.max_pages } : {}),
          ...(args.standard ? { standard: args.standard } : {}),
        },
        deps,
      );
      return toolResult(outcome);
    },
  );

  server.paidTool(
    "report",
    reportDescription(),
    PRICES_USD.report,
    {
      start_url: z.string().url(),
      max_pages: z.number().int().min(1).max(10).optional(),
      standard,
      language: z.enum(REPORT_LANGUAGES).optional(),
      authorized,
    },
    { readOnlyHint: true },
    async (args) => {
      const outcome = await buildReport(
        {
          start_url: args.start_url,
          authorized: true,
          ...(args.max_pages !== undefined ? { max_pages: args.max_pages } : {}),
          ...(args.standard ? { standard: args.standard } : {}),
          ...(args.language ? { language: args.language } : {}),
        },
        deps,
      );
      if (!outcome.ok) return toolResult(outcome);
      return { content: [{ type: "text", text: outcome.markdown }] };
    },
  );

  return server;
}

function toolResult(outcome: { ok: true; result: unknown } | { ok: false; message: string }): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  if (!outcome.ok) {
    return { isError: true, content: [{ type: "text", text: outcome.message }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(outcome.result) }] };
}
