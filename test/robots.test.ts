import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPathAllowed, parseRobots } from "../src/scan/robots";
import { UA } from "./helpers";

function robots(name: string): string {
  return readFileSync(new URL(`../fixtures/robots/${name}`, import.meta.url), "utf8");
}

describe("robots.txt", () => {
  it("applies the star group when A11yProbe has no group of its own", () => {
    const groups = parseRobots(robots("disallow-all.txt"));
    expect(isPathAllowed(groups, "/", UA)).toBe(false);
    expect(isPathAllowed(groups, "/docs", UA)).toBe(false);
  });

  it("lets a named A11yProbe group override the star group", () => {
    const groups = parseRobots(robots("allow-probe.txt"));
    expect(isPathAllowed(groups, "/docs", UA)).toBe(true);
    expect(isPathAllowed(groups, "/", "SomeOtherBot/1.0")).toBe(false);
  });

  it("honours an A11yProbe disallow while the star group allows the path", () => {
    const groups = parseRobots(robots("disallow-secret.txt"));
    expect(isPathAllowed(groups, "/secret", UA)).toBe(false);
    expect(isPathAllowed(groups, "/secret/page", UA)).toBe(false);
    expect(isPathAllowed(groups, "/public", UA)).toBe(true);
    expect(isPathAllowed(groups, "/secret", "OtherBot/1.0")).toBe(true);
  });

  it("uses the longest matching path and treats an empty disallow as allow-all", () => {
    const groups = parseRobots(`
      User-agent: *
      Disallow:
      Disallow: /private
      Allow: /private/open
    `);
    expect(isPathAllowed(groups, "/", UA)).toBe(true);
    expect(isPathAllowed(groups, "/private/file", UA)).toBe(false);
    expect(isPathAllowed(groups, "/private/open/file", UA)).toBe(true);
  });

  it("ignores comments and supports an end-of-path anchor", () => {
    const groups = parseRobots(`
      User-agent: * # everyone
      Disallow: /file$
      Allow: /
    `);
    expect(isPathAllowed(groups, "/file", UA)).toBe(false);
    expect(isPathAllowed(groups, "/file/more", UA)).toBe(true);
  });
});
