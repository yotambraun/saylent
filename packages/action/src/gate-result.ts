// Pure reducer: @saylent/engine's DomainCheck[] (packages/engine/src/domainChecks.ts,
// via runDomainChecks()) -> the Action's GateResult (types.ts). No network, no checks
// re-derived - every status/detail line here is copied verbatim from a DomainCheck the
// engine already produced. Kept separate from run.ts (which does the real crawl) so it
// is trivially testable against a fake checks array (DONE-CHECK: "main.ts logic against
// a fake gate result").
import type { BotSpec } from "@saylent/engine/domainChecks";
import type { DomainCheck } from "@saylent/engine/types";
import type { ClassKind, ClassRow, ClassStatus, GateResult, OtherFinding } from "./types";

const CLASS_ORDER: { kind: ClassKind; label: string }[] = [
  { kind: "training", label: "Training" },
  { kind: "search", label: "Search-index" },
  { kind: "user", label: "User-fetch" },
];

const RANK: Record<ClassStatus, number> = { pass: 0, warn: 1, fail: 2 };

function worst(a: ClassStatus, b: ClassStatus): ClassStatus {
  return RANK[b] > RANK[a] ? b : a;
}

/** "robots: GPTBot" -> "GPTBot"; "live fetch as GPTBot" -> "GPTBot"; else null. */
function agentOf(check: string): { agent: string; via: "robots.txt" | "live probe" } | null {
  if (check.startsWith("robots: ")) return { agent: check.slice("robots: ".length), via: "robots.txt" };
  if (check.startsWith("live fetch as ")) return { agent: check.slice("live fetch as ".length), via: "live probe" };
  return null;
}

/** checks with status "info" never move a class or the overall result - they are
 *  context (Google-Extended is a training token, not a crawler; the live-fetch
 *  caveat; robots.txt subpath scope). ClassStatus excludes "info" for that reason. */
function toClassStatus(status: DomainCheck["status"]): ClassStatus | null {
  if (status === "info") return null;
  return status;
}

export function computeGateResult(
  checks: DomainCheck[],
  registry: BotSpec[],
  domain: string,
  elapsedMs: number,
): GateResult {
  const kindByAgent = new Map(registry.map((b) => [b.agent, b.kind]));

  const classes: ClassRow[] = CLASS_ORDER.map(({ kind, label }) => ({
    kind,
    label,
    status: "pass" as ClassStatus,
    findings: [] as string[],
  }));
  const byKind = new Map(classes.map((c) => [c.kind, c]));

  const other: OtherFinding[] = [];
  let overall: ClassStatus = "pass";

  for (const c of checks) {
    const s = toClassStatus(c.status);
    if (s) overall = worst(overall, s);

    const parsed = agentOf(c.check);
    const kind = parsed ? kindByAgent.get(parsed.agent) : undefined;
    if (parsed && kind) {
      const row = byKind.get(kind)!;
      if (s) row.status = worst(row.status, s);
      row.findings.push(`${parsed.agent} (${parsed.via}): ${c.detail}`);
      continue;
    }
    other.push({ check: c.check, status: c.status, detail: c.detail });
  }

  return { domain, overall, classes, other, elapsedMs };
}
