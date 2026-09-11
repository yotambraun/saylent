// The spec (see METHODOLOGY.md) — group rules under each User-agent
// line (comments stripped); matching precedence = the SPECIFIC agent's group if
// one exists, else the "*" group; "Disallow:" with empty path = allow; blocked
// if any Disallow path is a prefix of "/" (i.e. the root is disallowed).
export interface RobotsGroup {
  agents: string[]; // lowercase
  disallow: string[];
  allow: string[];
}

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim(); // comments stripped
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!lastWasAgent || !current) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (current && (field === "disallow" || field === "allow")) {
      if (field === "disallow") current.disallow.push(value);
      else current.allow.push(value);
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

/** precedence: the specific agent's group(s) if any exist, else the "*" group */
export function groupFor(groups: RobotsGroup[], agent: string): RobotsGroup | null {
  const a = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((ga) => ga === a));
  if (specific.length > 0) {
    return {
      agents: [a],
      disallow: specific.flatMap((g) => g.disallow),
      allow: specific.flatMap((g) => g.allow),
    };
  }
  const star = groups.filter((g) => g.agents.includes("*"));
  if (star.length === 0) return null;
  return {
    agents: ["*"],
    disallow: star.flatMap((g) => g.disallow),
    allow: star.flatMap((g) => g.allow),
  };
}

/** blocked = any Disallow whose path is a prefix of "/" (empty path = allow) */
export function isBlocked(groups: RobotsGroup[], agent: string): boolean {
  const g = groupFor(groups, agent);
  if (!g) return false;
  return g.disallow.some((path) => path !== "" && "/".startsWith(path));
}

/** any group mentions this agent name explicitly (deprecated-agent detection) */
export function mentionsAgent(groups: RobotsGroup[], agent: string): boolean {
  const a = agent.toLowerCase();
  return groups.some((g) => g.agents.includes(a));
}
