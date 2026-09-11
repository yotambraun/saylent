// Shared types for the saylent/gate-check Action: the structured result the Action
// computes OVER @saylent/engine's raw DomainCheck[] output
// (packages/engine/src/domainChecks.ts) - never a reimplementation
// of the checks themselves, only a CI-shaped view of what runDomainChecks() already found.

/** The three bot classes the spec (2.3) and METHODOLOGY.md group crawlers into.
 *  Mirrors BotSpec["kind"] in packages/engine/src/domainChecks.ts. */
export type ClassKind = "training" | "search" | "user";

/** A class can never be "info" - only pass/warn/fail feed the gate. */
export type ClassStatus = "pass" | "warn" | "fail";

export interface ClassRow {
  kind: ClassKind;
  /** Display label for the summary table, e.g. "Search-index". */
  label: string;
  status: ClassStatus;
  /** One human-readable line per bot/check in this class (robots.txt + live probe). */
  findings: string[];
}

export interface OtherFinding {
  check: string;
  status: ClassStatus | "info";
  detail: string;
}

export interface GateResult {
  domain: string;
  /** Worst status across EVERY check (robots, live probe, JSON-LD, meta, coverage,
   *  entity clarity, freshness) - matches the CLI's own "Result" line
   *  (packages/cli/src/commands/gate-check.ts). This is the badge/output value,
   *  separate from which classes actually fail the JOB (see fail-on.ts). */
  overall: ClassStatus;
  /** training, search, user - in that order, always all three rows present. */
  classes: ClassRow[];
  /** Everything else runDomainChecks() reported: JSON-LD, meta directives,
   *  content coverage, homepage entity clarity, freshness, and the info/context
   *  rows (Google-Extended, deprecated agents, the live-fetch caveat, etc). */
  other: OtherFinding[];
  elapsedMs: number;
}
