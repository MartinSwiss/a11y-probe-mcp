/**
 * robots.txt matcher for A11yProbe and for "*".
 *
 * A named group that matches the product token wins over "*". When several
 * named groups match, the longest user-agent token wins and those groups are
 * combined. Within the selected rules, the longest matching path wins; an
 * allow and a disallow of equal length resolve to allow. An empty Disallow
 * means the group allows everything.
 */

export interface RobotRule {
  allow: boolean;
  path: string;
}

export interface RobotGroup {
  agents: string[];
  rules: RobotRule[];
}

export function parseRobots(text: string): RobotGroup[] {
  const groups: RobotGroup[] = [];
  let current: RobotGroup | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if (field === "allow" || field === "disallow") {
      if (!current) {
        current = { agents: ["*"], rules: [] };
        groups.push(current);
      }
      current.rules.push({ allow: field === "allow", path: value });
    }
  }

  return groups;
}

function pathMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const expression = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}${anchored ? "$" : ""}`).test(path);
}

function rulesAllow(rules: RobotRule[], path: string): boolean {
  let winner: { allow: boolean; length: number } | null = null;
  for (const rule of rules) {
    if (rule.path === "") continue;
    if (!pathMatches(rule.path, path)) continue;
    const length = rule.path.endsWith("$") ? rule.path.length - 1 : rule.path.length;
    if (
      !winner ||
      length > winner.length ||
      (length === winner.length && rule.allow && !winner.allow)
    ) {
      winner = { allow: rule.allow, length };
    }
  }
  return winner ? winner.allow : true;
}

/**
 * @param userAgent Full request user agent, for example `A11yProbe/1.0 (+https://example/)`.
 */
export function isPathAllowed(groups: RobotGroup[], path: string, userAgent: string): boolean {
  const product = (userAgent.split("/")[0] ?? userAgent).trim().toLowerCase();
  const haystack = userAgent.toLowerCase();
  let bestLength = -1;
  let selected: RobotGroup[] = [];

  for (const group of groups) {
    for (const agent of group.agents) {
      if (agent === "*" || agent === "") continue;
      const matches = product === agent || haystack.includes(agent);
      if (!matches) continue;
      if (agent.length > bestLength) {
        bestLength = agent.length;
        selected = [group];
      } else if (agent.length === bestLength && !selected.includes(group)) {
        selected.push(group);
      }
    }
  }

  if (selected.length === 0) {
    selected = groups.filter((group) => group.agents.includes("*"));
  }

  return rulesAllow(
    selected.flatMap((group) => group.rules),
    path || "/",
  );
}
