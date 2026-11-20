/**
 * Worker entry. The scan engine lives under src/scan. HTTP and MCP routes
 * are added in a later change; this placeholder keeps Wrangler pointed at
 * a module while the engine is reviewed on its own.
 */
export default {
  async fetch(): Promise<Response> {
    return Response.json({
      name: "a11y-probe-mcp",
      status: "scan-engine",
    });
  },
} satisfies ExportedHandler;
