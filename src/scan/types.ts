import type { Standard } from "../config";

export type Impact = "critical" | "serious" | "moderate" | "minor";

export interface Violation {
  ruleId: string;
  impact: Impact | null;
  wcagTags: string[];
  help: string;
  helpUrl: string;
  nodeCount: number;
  /** At most three CSS selectors, one from each of the first nodes. */
  selectors: string[];
  /** Element HTML, truncated to 200 characters. */
  html: string;
}

export interface ImpactSummary {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
}

export interface ScanPageResult {
  url: string;
  standard: Standard;
  summary: ImpactSummary;
  violations: Violation[];
  incompleteCount: number;
  passCount: number;
  engineVersion: string;
  timestamp: string;
}

export interface TopIssue {
  ruleId: string;
  impact: Impact | null;
  help: string;
  helpUrl: string;
  pageCount: number;
  nodeCount: number;
}

export interface ScanSiteResult {
  startUrl: string;
  standard: Standard;
  pagesScanned: number;
  pages: ScanPageResult[];
  topIssues: TopIssue[];
  /** Same-origin URLs skipped because robots.txt disallows them. */
  skipped: Array<{ url: string; reason: "robots" | "fetch_failed" | "timeout" }>;
  engineVersion: string;
  timestamp: string;
}

export type ScanErrorCode =
  | "unauthorized"
  | "invalid_input"
  | "ssrf"
  | "robots"
  | "timeout"
  | "browser_busy"
  | "fetch_failed";

export interface ScanFailure {
  ok: false;
  code: ScanErrorCode;
  message: string;
}

export interface RawAxeNode {
  target?: unknown;
  html?: string;
}

export interface RawAxeViolation {
  id: string;
  impact?: string | null;
  tags?: string[];
  help?: string;
  helpUrl?: string;
  nodes?: RawAxeNode[];
}

/** Subset of the rule-engine result the mapper needs. */
export interface RawAxeResults {
  violations?: RawAxeViolation[];
  incomplete?: unknown[];
  passes?: unknown[];
  testEngine?: { version?: string };
}

export interface InspectedPage {
  raw: RawAxeResults;
  links: string[];
}

export function failure(code: ScanErrorCode, message: string): ScanFailure {
  return { ok: false, code, message };
}
