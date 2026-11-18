import { LIMITS } from "../config";

/** Truncate an element snippet to the configured maximum, on a character boundary. */
export function truncateSnippet(html: string, max: number = LIMITS.snippetMaxChars): string {
  if (max < 0) return "";
  const value = html ?? "";
  if (value.length <= max) return value;
  return value.slice(0, max);
}
