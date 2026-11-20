import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mapAxeResults } from "../src/scan/map-results";
import { auditHtml, serveDir } from "./helpers";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/pages");

describe("fixture pages", () => {
  it("reports the expected rule ids for a page with known violations", async () => {
    const server = await serveDir(fixtures);
    try {
      const response = await fetch(`${server.url}/known-violations.html`);
      expect(response.status).toBe(200);
      const html = await response.text();
      const raw = await auditHtml(html, "wcag22aa");
      const mapped = mapAxeResults(raw, {
        url: `${server.url}/known-violations.html`,
        standard: "wcag22aa",
        timestamp: "2026-11-18T12:00:00.000Z",
      });
      const ids = mapped.violations.map((violation) => violation.ruleId).sort();
      expect(ids).toEqual(
        ["button-name", "document-title", "html-has-lang", "image-alt", "label", "link-name"].sort(),
      );
      for (const violation of mapped.violations) {
        expect(violation.html.length).toBeLessThanOrEqual(200);
        expect(violation.selectors.length).toBeLessThanOrEqual(3);
        expect(violation.nodeCount).toBeGreaterThan(0);
      }
      expect(mapped.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    } finally {
      await server.close();
    }
  });

  it("does not flag the clean fixture for those same rules", async () => {
    const html = readFileSync(join(fixtures, "clean.html"), "utf8");
    const raw = await auditHtml(html, "wcag22aa");
    const ids = new Set((raw.violations ?? []).map((violation) => violation.id));
    for (const absent of ["image-alt", "button-name", "document-title", "html-has-lang", "link-name", "label"]) {
      expect(ids.has(absent), absent).toBe(false);
    }
  });
});
