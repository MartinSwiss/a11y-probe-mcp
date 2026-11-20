import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildReport } from "../src/scan/report";
import { depsFor, scriptedFetch } from "./helpers";

const home = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../fixtures/pages/site-home.html"),
  "utf8",
);

describe("report", () => {
  it("renders a template report with a prioritised list and the required disclaimer", async () => {
    const fetchImpl = scriptedFetch({
      "https://example.com/robots.txt": { status: 404 },
      "https://example.com/": { body: home, headers: { "content-type": "text/html" } },
    });
    const outcome = await buildReport(
      { start_url: "https://example.com/", max_pages: 1, language: "de", authorized: true },
      depsFor(fetchImpl),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.markdown).toContain("# Bericht zur Barrierefreiheit");
    expect(outcome.markdown).toContain("## Priorisierte Korrekturen");
    expect(outcome.markdown).toContain("image-alt");
    expect(outcome.markdown).toContain("not legal advice, no compliance guarantee");
    expect(outcome.markdown).toContain("57%");
    expect(outcome.markdown.toLowerCase()).not.toContain("openai");
    expect(outcome.markdown.toLowerCase()).not.toContain("language model");
  });

  it("rejects an unknown language before fetching", async () => {
    const fetchImpl = scriptedFetch({});
    const outcome = await buildReport(
      {
        start_url: "https://example.com/",
        authorized: true,
        language: "es" as "en",
      },
      depsFor(fetchImpl),
    );
    expect(outcome).toMatchObject({ ok: false, code: "invalid_input" });
    expect(fetchImpl.urls).toEqual([]);
  });
});
