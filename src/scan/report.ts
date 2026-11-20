import { COVERAGE_NOTE, REPORT_LANGUAGES, type ReportLanguage, type Standard } from "../config";
import { scanSite, type ScanDeps, type ScanSiteInput } from "./scan";
import type { Impact, ScanFailure, ScanPageResult, ScanSiteResult, TopIssue } from "./types";

export interface ReportInput extends ScanSiteInput {
  language?: ReportLanguage;
}

export type ReportOutcome =
  | { ok: true; markdown: string; result: ScanSiteResult }
  | ScanFailure;

const IMPACT_ORDER: Impact[] = ["critical", "serious", "moderate", "minor"];

interface Copy {
  title: string;
  scanned: string;
  standard: string;
  generated: string;
  fixes: string;
  none: string;
  pages: string;
  violations: string;
  incomplete: string;
  passes: string;
  nodes: string;
  impact: Record<Impact, string>;
}

const COPY: Record<ReportLanguage, Copy> = {
  en: {
    title: "Accessibility scan report",
    scanned: "Pages scanned",
    standard: "Standard",
    generated: "Generated",
    fixes: "Prioritised fixes",
    none: "No violations were reported by the automated checks.",
    pages: "Pages",
    violations: "Violations",
    incomplete: "Incomplete",
    passes: "Passes",
    nodes: "nodes",
    impact: { critical: "Critical", serious: "Serious", moderate: "Moderate", minor: "Minor" },
  },
  de: {
    title: "Bericht zur Barrierefreiheit",
    scanned: "Geprüfte Seiten",
    standard: "Standard",
    generated: "Erstellt",
    fixes: "Priorisierte Korrekturen",
    none: "Die automatischen Prüfungen haben keine Verstösse gemeldet.",
    pages: "Seiten",
    violations: "Verstösse",
    incomplete: "Unvollständig",
    passes: "Bestanden",
    nodes: "Knoten",
    impact: { critical: "Kritisch", serious: "Ernst", moderate: "Mittel", minor: "Gering" },
  },
  fr: {
    title: "Rapport d'accessibilité",
    scanned: "Pages analysées",
    standard: "Norme",
    generated: "Généré",
    fixes: "Corrections priorisées",
    none: "Les contrôles automatiques n'ont signalé aucune violation.",
    pages: "Pages",
    violations: "Violations",
    incomplete: "Incomplets",
    passes: "Réussites",
    nodes: "nœuds",
    impact: { critical: "Critique", serious: "Sérieux", moderate: "Modéré", minor: "Mineur" },
  },
};

const DISCLAIMER = "not legal advice, no compliance guarantee";

export async function buildReport(input: ReportInput, deps: ScanDeps): Promise<ReportOutcome> {
  const language = input.language ?? "en";
  if (!(REPORT_LANGUAGES as readonly string[]).includes(language)) {
    return { ok: false, code: "invalid_input", message: "language must be de, fr, or en" };
  }
  const scanned = await scanSite(input, deps);
  if (!scanned.ok) return scanned;
  return {
    ok: true,
    result: scanned.result,
    markdown: renderReport(scanned.result, language),
  };
}

export function renderReport(result: ScanSiteResult, language: ReportLanguage): string {
  const copy = COPY[language];
  const lines: string[] = [
    `# ${copy.title}`,
    "",
    `- ${copy.scanned}: ${result.pagesScanned}`,
    `- ${copy.standard}: ${result.standard}`,
    `- ${copy.generated}: ${result.timestamp}`,
    "",
    COVERAGE_NOTE,
    "",
    `## ${copy.fixes}`,
    "",
  ];

  if (result.topIssues.length === 0) {
    lines.push(copy.none, "");
  } else {
    for (const impact of IMPACT_ORDER) {
      const issues = result.topIssues.filter((issue) => issue.impact === impact);
      if (issues.length === 0) continue;
      lines.push(`### ${copy.impact[impact]}`, "");
      for (const issue of issues) {
        lines.push(formatIssue(issue, copy, result.pages));
      }
    }
  }

  lines.push(`## ${copy.pages}`, "");
  for (const page of result.pages) {
    lines.push(
      `### ${page.url}`,
      "",
      `- ${copy.violations}: ${page.violations.length}`,
      `- ${copy.incomplete}: ${page.incompleteCount}`,
      `- ${copy.passes}: ${page.passCount}`,
      "",
    );
  }

  if (result.skipped.length > 0) {
    lines.push("## Skipped", "");
    for (const skip of result.skipped) {
      lines.push(`- ${skip.url} (${skip.reason})`);
    }
    lines.push("");
  }

  lines.push(DISCLAIMER, "");
  return lines.join("\n");
}

function formatIssue(issue: TopIssue, copy: Copy, pages: ScanPageResult[]): string {
  const where = pages
    .filter((page) => page.violations.some((violation) => violation.ruleId === issue.ruleId))
    .map((page) => page.url);
  const selectors = pages
    .flatMap((page) => page.violations)
    .filter((violation) => violation.ruleId === issue.ruleId)
    .flatMap((violation) => violation.selectors)
    .slice(0, 3);
  const lines = [
    `- **${issue.ruleId}** (${issue.nodeCount} ${copy.nodes}, ${issue.pageCount} ${copy.pages.toLowerCase()}): ${issue.help}`,
  ];
  if (issue.helpUrl) lines.push(`  - ${issue.helpUrl}`);
  for (const url of where) lines.push(`  - ${url}`);
  if (selectors.length > 0) lines.push(`  - \`${selectors.join("`, `")}\``);
  return lines.join("\n");
}

export function isReportLanguage(value: string): value is ReportLanguage {
  return (REPORT_LANGUAGES as readonly string[]).includes(value);
}

export type { Standard };
