import { describe, expect, it } from "vitest";
import { checkContrast, contrastRatio, parseColor } from "../src/check/contrast";

describe("contrast", () => {
  it("matches the WCAG black/white and red/white ratios", () => {
    const black = parseColor("#000000");
    const white = parseColor("#ffffff");
    const red = parseColor("#ff0000");
    if (!black || !white || !red) throw new Error("colors");
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(red, white)).toBeCloseTo(3.998, 2);

    const result = checkContrast({
      pairs: [
        { foreground: "black", background: "white" },
        { foreground: "hsl(0, 100%, 50%)", background: "rgb(255, 255, 255)" },
        { foreground: "#777777", background: "#ffffff", fontSizePx: 16 },
      ],
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.result.pairs[0]?.ratio).toBe(21);
    expect(result.result.pairs[0]?.aa.normal).toBe(true);
    expect(result.result.pairs[0]?.aaa.normal).toBe(true);
    expect(result.result.pairs[0]?.suggestion).toBeNull();
    expect(result.result.pairs[1]?.ratio).toBeCloseTo(4, 1);
    expect(result.result.pairs[1]?.aa.normal).toBe(false);
    expect(result.result.pairs[1]?.aa.large).toBe(true);
    expect(result.result.pairs[1]?.nonText).toBe(true);
    expect(result.result.pairs[2]?.aa.normal).toBe(false);
  });

  it("suggests a nearer foreground with the same hue that meets AA", () => {
    const outcome = checkContrast({
      pairs: [{ foreground: "#ff0000", background: "#ffffff" }],
    });
    if (!outcome.ok) throw new Error(outcome.message);
    const suggestion = outcome.result.pairs[0]?.suggestion;
    expect(suggestion).toMatch(/^#[0-9a-f]{6}$/);
    const next = parseColor(suggestion ?? "");
    const white = parseColor("#ffffff");
    if (!next || !white) throw new Error("suggestion");
    expect(contrastRatio(next, white)).toBeGreaterThanOrEqual(4.5);
    expect(next.r).toBeGreaterThan(next.g);
    expect(next.r).toBeGreaterThan(next.b);
  });

  it("treats 24px and bold 18.67px text as large", () => {
    const large = checkContrast({
      pairs: [{ foreground: "#ff0000", background: "#ffffff", fontSizePx: 24 }],
    });
    const bold = checkContrast({
      pairs: [{ foreground: "#ff0000", background: "#ffffff", fontSizePx: 18.67, bold: true }],
    });
    if (!large.ok || !bold.ok) throw new Error("size");
    expect(large.result.pairs[0]?.suggestion).toBeNull();
    expect(bold.result.pairs[0]?.suggestion).toBeNull();
  });
});
