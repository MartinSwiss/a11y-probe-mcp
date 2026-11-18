import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function bundledSource(keepNames: boolean): Promise<string> {
  const scratch = join(repoRoot, ".tmp");
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, "axe-"));
  const entry = join(dir, "entry.mjs");
  const outfile = join(dir, "out.mjs");
  writeFileSync(entry, `import axe from "axe-core";\nexport function source(){ return axe.source; }\n`);
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: "esm",
    platform: "node",
    keepNames,
    absWorkingDir: repoRoot,
  });
  const mod = (await import(pathToFileURL(outfile).href)) as { source: () => string };
  return mod.source();
}

describe("rule engine source injection", () => {
  it("evaluates in a page when names are not preserved, and throws when they are", async () => {
    const clean = await bundledSource(false);
    expect(clean.includes("__name(")).toBe(false);
    const dom = new JSDOM("<!doctype html><html><body><img src='x'></body></html>", {
      runScripts: "dangerously",
      url: "https://fixture.example/",
    });
    try {
      dom.window.eval(clean);
      const engine = (dom.window as unknown as { axe: { run: (node: unknown, options: unknown) => Promise<{ violations: Array<{ id: string }> }> } }).axe;
      const result = await engine.run(dom.window.document, {
        runOnly: { type: "tag", values: ["wcag2a"] },
        resultTypes: ["violations"],
      });
      expect(result.violations.map((violation) => violation.id)).toContain("image-alt");
    } finally {
      dom.window.close();
    }

    const preserved = await bundledSource(true);
    expect(preserved.includes("__name(")).toBe(true);
    const broken = new JSDOM("<!doctype html><html><body></body></html>", {
      runScripts: "dangerously",
      url: "https://fixture.example/",
    });
    try {
      expect(() => broken.window.eval(preserved)).toThrow(/__name/);
    } finally {
      broken.window.close();
    }
  });
});
