// The story lede above the Domain gates table.
// "Not crawled = not cited." is OUR paraphrase of the crawl→citation dependency,
// never attributed to anyone. The live per-UA fetch is the differentiator (a CDN
// silently 403ing a bot robots.txt allows), so it leads. The lede NEVER rewrites
// a stored check detail — it composes around it verbatim. Pure: no React/
// Supabase/Next. Agent naming mirrors src/engine/domainChecks.ts.

/** Minimal domain-check shape — a structural subset of the dossier's CheckRow. */
export interface GateCheck {
  check_name: string;
  status: "pass" | "warn" | "info" | "fail";
  detail: string;
}

export interface GatesLede {
  headline: string;
  story: string;
}

const LIVE_FETCH_PREFIX = "live fetch as ";
const ROBOTS_AGENT_PREFIX = "robots: ";

// domainChecks.ts marks a blocked TRAINING crawler as WARN and a blocked
// SEARCH/USER agent as FAIL — a search/user block is the more damning cite-killer.
const TRAINING_AGENTS = new Set(["GPTBot", "ClaudeBot"]);
// most-damning-first ordering among the live-fetch agents (domainChecks.ts).
const AGENT_ORDER = ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "PerplexityBot", "GPTBot", "ClaudeBot"];

/** Lower = more damning: search/user agents (tier 0) before training (tier 1),
 *  then by the registry order, then by name so unknown agents stay deterministic. */
function agentRank(agent: string): number {
  const tier = TRAINING_AGENTS.has(agent) ? 1 : 0;
  const idx = AGENT_ORDER.indexOf(agent);
  return tier * 100 + (idx === -1 ? AGENT_ORDER.length : idx);
}

function mostDamning(checks: GateCheck[], prefix: string): { agent: string; detail: string } | null {
  const fails = checks
    .filter((c) => c.status === "fail" && c.check_name.startsWith(prefix))
    .map((c) => ({ agent: c.check_name.slice(prefix.length), detail: c.detail }));
  if (fails.length === 0) return null;
  return [...fails].sort((a, b) => agentRank(a.agent) - agentRank(b.agent) || a.agent.localeCompare(b.agent))[0];
}

/** "just now" is false the moment the file is written, and these reports are
 *  read for years. When the caller knows the run date, the sentence carries it;
 *  with no date it simply drops the time phrase rather than lying. */
const when = (runDate?: string | null): string =>
  runDate && runDate.trim() ? ` on ${runDate.trim()}` : "";

export function gatesLede(
  checks: GateCheck[],
  domain: string,
  runDate?: string | null,
): GatesLede | null {
  if (checks.length === 0) return null;

  // State 1 — a live per-UA fetch was blocked (CDN/WAF overriding robots.txt).
  const live = mostDamning(checks, LIVE_FETCH_PREFIX);
  if (live) {
    return {
      headline: "Not crawled = not cited.",
      story: `We fetched ${domain} as ${live.agent}${when(runDate)}: ${live.detail}`,
    };
  }

  // State 2 — robots.txt itself blocks a crawler the engines rely on.
  const robots = mostDamning(checks, ROBOTS_AGENT_PREFIX);
  if (robots) {
    return {
      headline: "Not crawled = not cited.",
      story: `We read ${domain}'s robots.txt${when(runDate)}: ${robots.agent} is ${robots.detail}`,
    };
  }

  // State 3 — no crawl-access fail: the positive story.
  const knocks = checks.filter((c) => c.check_name.startsWith(LIVE_FETCH_PREFIX)).length;
  return {
    headline: "Your gates are open.",
    story:
      knocks > 0
        ? `We knocked as ${knocks} AI crawlers${when(runDate)}. Your site answered every one.`
        : "Nothing we checked is blocking the AI crawlers.",
  };
}

/* ------------------------- the gate table's own lede ----------------------- */

export interface GateTally {
  fail: number;
  warn: number;
  info: number;
  pass: number;
  total: number;
  /** "3 fail · 3 warn · 2 info · 15 pass" — zero terms drop out */
  line: string;
}

/** The one line above 23 rows of equal visual weight, so a stranger can find
 *  the three that matter. Every term is a real row count, and they add up to
 *  the number of rows in the table. */
export function gateTally(checks: GateCheck[]): GateTally {
  const n = (s: GateCheck["status"]) => checks.filter((c) => c.status === s).length;
  const fail = n("fail");
  const warn = n("warn");
  const info = n("info");
  const pass = n("pass");
  const parts: string[] = [];
  if (fail > 0) parts.push(`${fail} fail`);
  if (warn > 0) parts.push(`${warn} warn`);
  if (info > 0) parts.push(`${info} info`);
  if (pass > 0) parts.push(`${pass} pass`);
  return { fail, warn, info, pass, total: checks.length, line: parts.join(" · ") };
}

/** The contradiction a reader WILL notice: "robots: PerplexityBot — blocked"
 *  (FAIL) sitting next to "live fetch as PerplexityBot — HTTP 200" (PASS). Both
 *  are true and they mean one thing together, so say it in one sentence.
 *  Null when no agent has that pair. */
export function robotsVsLiveNote(checks: GateCheck[]): string | null {
  const blockedByRobots = checks
    .filter((c) => c.check_name.startsWith(ROBOTS_AGENT_PREFIX) && (c.status === "fail" || c.status === "warn"))
    .map((c) => c.check_name.slice(ROBOTS_AGENT_PREFIX.length));
  const servedLive = new Set(
    checks
      .filter((c) => c.check_name.startsWith(LIVE_FETCH_PREFIX) && c.status === "pass")
      .map((c) => c.check_name.slice(LIVE_FETCH_PREFIX.length)),
  );
  const both = blockedByRobots.filter((a) => servedLive.has(a)).sort((a, b) => agentRank(a) - agentRank(b) || a.localeCompare(b));
  if (both.length === 0) return null;
  const agents = both.length === 1 ? both[0] : `${both.slice(0, -1).join(", ")} and ${both[both.length - 1]}`;
  return `Both rows are true for ${agents}: your server answers us, and robots.txt tells the crawler not to ask. The crawler obeys robots.txt, so the page is never fetched.`;
}
