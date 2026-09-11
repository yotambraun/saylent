// The JSON contract of `GET /api/check?domain=` —
// the free instant gate check. This is a VIEW over @saylent/engine's own
// DomainCheck[] rows (packages/engine/src/domainChecks.ts) — the same four
// groups `saylent gate-check` prints: robots
// per bot class, the live per-UA probe, JSON-LD, meta directives. No check is
// re-derived here; every status and detail string is copied from a row the
// engine already produced (src/gate.ts).
//
// Field names are snake_case because this is a public HTTP payload, not an
// internal TS object.

export type Verdict = "pass" | "warn" | "fail";

/** Bot classes, as METHODOLOGY.md groups them. Mirrors BotSpec["kind"]. */
export type BotClass = "training" | "search" | "user";

export interface BotRow {
  agent: string;
  /** robots.txt verdict for this agent: pass = allowed, warn = a training bot
   *  is blocked (a legitimate choice), fail = a search/user bot is blocked. */
  status: Verdict;
  detail: string;
}

export interface RobotsSection {
  status: Verdict;
  /** false when robots.txt was unreachable or empty — engines assume "allow",
   *  but the site has no control surface. */
  readable: boolean;
  training: BotRow[];
  search: BotRow[];
  user: BotRow[];
  /** Context rows that never move the verdict: Google-Extended (a training
   *  token, not a crawler), deprecated agents, robots.txt scope on a subpath. */
  notes: string[];
}

export interface ProbeRow {
  agent: string;
  /** The HTTP status the site returned to that exact User-Agent, or
   *  "unreachable". */
  http: string;
  status: Verdict;
  detail: string;
}

export interface ProbeSection {
  status: Verdict;
  agents: ProbeRow[];
  /** Context that never moves the verdict — chiefly the live-fetch caveat
   *  (a 200 to our UA is evidence, not proof, that the engine's own fetch
   *  from its own network is allowed). */
  notes: string[];
}

export interface SchemaRow {
  type: string;
  present: boolean;
  status: Verdict;
  detail: string;
}

export interface JsonLdSection {
  status: Verdict;
  /** false when NO page could be read at all. The engine's honesty guard skips
   *  every page-level check on a blanked crawl rather than failing it
   *  (packages/engine/src/domainChecks.ts), so an empty `types` must never be
   *  rendered as "your schema is fine" — it means "we could not look". */
  checked: boolean;
  types: SchemaRow[];
}

export interface MetaSection {
  status: Verdict;
  /** false when NO page could be read — same reason as JsonLdSection.checked. */
  checked: boolean;
  noindex: boolean;
  nosnippet: boolean;
  findings: { check: string; status: Verdict; detail: string }[];
}

export interface InstantCheckResult {
  domain: string;
  /** Worst status across the four sections below — robots, probe, jsonld,
   *  meta. `notes` never move it (see src/gate.ts for why the two brand-model
   *  checks the CLI also reports are not part of a keyless check). */
  result: Verdict;
  robots: RobotsSection;
  probe: ProbeSection;
  jsonld: JsonLdSection;
  meta: MetaSection;
  /** Anything the engine reported that is not one of the four rows above
   *  (a failed crawl, a stale year in a page title). Context only: these never
   *  move `result`. */
  notes: string[];
  /** ISO 8601, UTC. On a cache hit this is the time of the ORIGINAL check, not
   *  of this request — that is the point of `cached`. */
  checked_at: string;
  cached: boolean;
  elapsed_ms: number;
  pages_crawled: number;
}

export type ErrorCode =
  | "method_not_allowed"
  | "missing_domain"
  | "invalid_domain"
  | "rate_limited"
  | "timeout"
  | "check_failed";

export interface InstantCheckError {
  error: {
    code: ErrorCode;
    message: string;
    /** Present on `rate_limited` only: seconds until the next token. */
    retry_after?: number;
  };
}

/** The one seam the HTTP handler knows about — src/gate.ts supplies the real
 *  (engine-backed) implementation, tests supply a fake. */
export type GateFn = (domain: string) => Promise<InstantCheckResult>;
