import { describe, expect, it } from "vitest";
import { LIMITS } from "../src/config";
import { mapAxeResults } from "../src/scan/map-results";
import { truncateSnippet } from "../src/scan/snippet";
import type { RawAxeResults } from "../src/scan/types";

describe("snippet truncation", () => {
  it("leaves short snippets unchanged and cuts longer ones at 200 characters", () => {
    expect(truncateSnippet("<img alt=\"\">")).toBe("<img alt=\"\">");
    const long = `<img src="x" data-note="${"A".repeat(400)}">`;
    expect(long.length).toBeGreaterThan(LIMITS.snippetMaxChars);
    const truncated = truncateSnippet(long);
    expect(truncated.length).toBe(200);
    expect(long.startsWith(truncated)).toBe(true);
  });

  it("keeps at most three selectors and a 200 character snippet on a violation", () => {
    const raw: RawAxeResults = {
      violations: [
        {
          id: "image-alt",
          impact: "critical",
          tags: ["wcag2a", "cat.text-alternatives"],
          help: "Images must have alternative text",
          helpUrl: "https://dequeuniversity.com/rules/axe/4.14/image-alt",
          nodes: [
            { target: ["img.one"], html: "H".repeat(240) },
            { target: ["img.two"], html: "two" },
            { target: ["img.three"], html: "three" },
            { target: ["img.four"], html: "four" },
          ],
        },
      ],
      incomplete: [{}],
      passes: [{}, {}, {}],
      testEngine: { version: "4.14.1" },
    };
    const mapped = mapAxeResults(raw, {
      url: "https://example.com/",
      standard: "wcag22aa",
      timestamp: "2026-11-18T12:00:00.000Z",
    });
    expect(mapped.summary).toEqual({ critical: 1, serious: 0, moderate: 0, minor: 0 });
    expect(mapped.violations).toHaveLength(1);
    const violation = mapped.violations[0]!;
    expect(violation.ruleId).toBe("image-alt");
    expect(violation.wcagTags).toEqual(["wcag2a"]);
    expect(violation.selectors).toEqual(["img.one", "img.two", "img.three"]);
    expect(violation.nodeCount).toBe(4);
    expect(violation.html.length).toBe(200);
    expect(mapped.incompleteCount).toBe(1);
    expect(mapped.passCount).toBe(3);
    expect(mapped.engineVersion).toBe("4.14.1");
  });
});
