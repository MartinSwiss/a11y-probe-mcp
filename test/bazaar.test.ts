import { readFileSync } from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { bazaarResourceServerExtension, validateDiscoveryExtension } from "@x402/extensions/bazaar";
import { describe, expect, it } from "vitest";
import { bazaarForHttp, bazaarForTool } from "../src/payments/bazaar";

const httpPaths = ["/api/v1/check/contrast", "/api/v1/check/links-meta", "/api/v1/scan/page", "/api/v1/scan/site", "/api/v1/report"];
const tools = ["check_contrast", "check_links_meta", "scan_page", "scan_site", "report"] as const;

function enrich(path: string) {
  const declared = bazaarForHttp(path).bazaar as Parameters<NonNullable<typeof bazaarResourceServerExtension.enrichDeclaration>>[0];
  return bazaarResourceServerExtension.enrichDeclaration?.(declared, {
    method: "POST",
    adapter: { getPath: () => path },
  });
}

describe("bazaar discovery", () => {
  it("validates HTTP examples, including method POST and authorized true", () => {
    for (const path of httpPaths) {
      const extension = enrich(path) as {
        info: { input: { method?: string; body?: { authorized?: boolean } } };
      };
      expect(extension.info.input.method, path).toBe("POST");
      if (path.endsWith("/check/contrast")) {
        const body = extension.info.input.body as { pairs?: Array<{ foreground?: string }> };
        expect(body.pairs?.[0]?.foreground, path).toBe("#767676");
      } else {
        expect(extension.info.input.body?.authorized, path).toBe(true);
      }
      const result = validateDiscoveryExtension(extension as never);
      expect(result.valid, `${path} ${result.errors?.join("; ")}`).toBe(true);
    }
  });

  it("validates MCP tool examples that include authorized true", () => {
    for (const tool of tools) {
      const extension = bazaarForTool(tool).bazaar as {
        info: { input: { example?: { authorized?: boolean } } };
      };
      if (tool === "check_contrast") {
        const example = extension.info.input.example as { pairs?: unknown[] };
        expect(example.pairs?.length, tool).toBeGreaterThan(0);
      } else {
        expect(extension.info.input.example?.authorized, tool).toBe(true);
      }
      const result = validateDiscoveryExtension(extension as never);
      expect(result.valid, `${tool} ${result.errors?.join("; ")}`).toBe(true);
    }
  });
});

describe("server.json", () => {
  it("matches the MCP registry schema, including the website URL", async () => {
    const schema = (await fetch("https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json").then((response) =>
      response.json(),
    )) as object;
    const manifest = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8")) as { websiteUrl?: string };
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    expect(validate(manifest), ajv.errorsText(validate.errors)).toBe(true);
    expect(manifest.websiteUrl).toBe("https://a11y.aiagentpay.cloud/");
  });
});
