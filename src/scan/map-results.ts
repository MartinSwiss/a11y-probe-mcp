import { LIMITS, type Standard } from "../config";
import { truncateSnippet } from "./snippet";
import type {
  Impact,
  ImpactSummary,
  RawAxeResults,
  ScanPageResult,
  TopIssue,
  Violation,
} from "./types";

const IMPACTS: readonly Impact[] = ["critical", "serious", "moderate", "minor"];

function asImpact(value: string | null | undefined): Impact | null {
  if (value && (IMPACTS as readonly string[]).includes(value)) return value as Impact;
  return null;
}

function selectorOf(target: unknown): string | undefined {
  if (typeof target === "string" && target !== "") return target;
  if (!Array.isArray(target) || target.length === 0) return undefined;
  const first = target[0];
  if (typeof first === "string" && first !== "") return first;
  if (Array.isArray(first) && typeof first[0] === "string") return first[0];
  return undefined;
}

export function mapAxeResults(
  raw: RawAxeResults,
  input: { url: string; standard: Standard; timestamp: string },
): ScanPageResult {
  const summary: ImpactSummary = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const violations: Violation[] = [];

  for (const item of raw.violations ?? []) {
    const impact = asImpact(item.impact);
    if (impact) summary[impact] += 1;
    const nodes = item.nodes ?? [];
    const selectors: string[] = [];
    for (const node of nodes) {
      const selector = selectorOf(node.target);
      if (!selector) continue;
      selectors.push(selector);
      if (selectors.length === LIMITS.selectorsPerViolation) break;
    }
    violations.push({
      ruleId: item.id,
      impact,
      wcagTags: (item.tags ?? []).filter((tag) => tag.startsWith("wcag")),
      help: item.help ?? "",
      helpUrl: item.helpUrl ?? "",
      nodeCount: nodes.length,
      selectors,
      html: truncateSnippet(nodes[0]?.html ?? ""),
    });
  }

  return {
    url: input.url,
    standard: input.standard,
    summary,
    violations,
    incompleteCount: raw.incomplete?.length ?? 0,
    passCount: raw.passes?.length ?? 0,
    engineVersion: raw.testEngine?.version ?? "",
    timestamp: input.timestamp,
  };
}

const IMPACT_RANK: Record<Impact, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
};

export function aggregateIssues(pages: ScanPageResult[]): TopIssue[] {
  const byRule = new Map<string, TopIssue>();
  for (const page of pages) {
    for (const violation of page.violations) {
      const existing = byRule.get(violation.ruleId);
      if (!existing) {
        byRule.set(violation.ruleId, {
          ruleId: violation.ruleId,
          impact: violation.impact,
          help: violation.help,
          helpUrl: violation.helpUrl,
          pageCount: 1,
          nodeCount: violation.nodeCount,
        });
        continue;
      }
      existing.pageCount += 1;
      existing.nodeCount += violation.nodeCount;
    }
  }
  return [...byRule.values()].sort((a, b) => {
    const rankA = a.impact ? IMPACT_RANK[a.impact] : 4;
    const rankB = b.impact ? IMPACT_RANK[b.impact] : 4;
    if (rankA !== rankB) return rankA - rankB;
    return b.nodeCount - a.nodeCount;
  });
}
