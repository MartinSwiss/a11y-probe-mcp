import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("stdio entry", () => {
  it("lists the tools and answers get_pricing without a network", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--experimental-strip-types", "src/stdio.ts"],
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stderr: "pipe",
      env: { ...process.env, A11Y_PROBE_URL: "" },
    });
    const client = new Client({ name: "stdio-test", version: "0.0.1" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        "get_pricing",
        "report",
        "scan_page",
        "scan_site",
      ]);
      const pricing = await client.callTool({ name: "get_pricing", arguments: {} });
      const text = (pricing.content as Array<{ text?: string }>)[0]?.text ?? "";
      expect(text).toContain("0.05");
      expect(text).toContain("57%");
      const blocked = await client.callTool({
        name: "scan_page",
        arguments: { url: "https://example.com/", authorized: true },
      });
      expect(blocked.isError).toBe(true);
      const message = (blocked.content as Array<{ text?: string }>)[0]?.text ?? "";
      expect(message).toContain("A11Y_PROBE_URL");
    } finally {
      await client.close();
    }
  });
});