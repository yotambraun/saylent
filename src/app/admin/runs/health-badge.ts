// /admin/runs quality feed — pure presentation helper. Turns a run's
// (status, runs.health) into ONE honest badge for the operator feed. The health
// grade is READ from run-health.ts's persisted contract (migration 0031); this
// file never derives a grade — a run with no health row is shown honestly as
// "pre-health" gray, NOT a faked grade. status failed/running always win over
// health (the contract note in run-health.ts): a terminally-failed run reads
// "failed" even if a stale health blob says otherwise.
import type { RunHealth, RunHealthGrade } from "@saylent/report/run-health";

// The badge's classification — a superset of RunHealthGrade with the operational
// states health can't express (a run still in flight, or one with no health row).
export type RunBadgeKind = RunHealthGrade | "running" | "queued" | "pre-health";

export interface RunBadge {
  kind: RunBadgeKind;
  label: string;
  /** tailwind classes matching the app's pill conventions (dossier PRESENT/ABSENT) */
  cls: string;
  /** degraded/failed are loud; ok/weak/pre-health/in-flight are quiet */
  loud: boolean;
  /** operator notes (health.notes[]) — [] when none / pre-health */
  notes: string[];
  /** true when this badge counts as a "problem" (degraded or failed or status=failed) */
  problem: boolean;
  /** true when this badge is a "weak" product outcome (not a bug) */
  weak: boolean;
}

const GRADE_STYLE: Record<RunHealthGrade, { label: string; cls: string; loud: boolean }> = {
  // quiet + positive
  ok: { label: "ok", cls: "bg-success/10 text-success ring-1 ring-success/20", loud: false },
  // quiet + honest: a weak result is a PRODUCT outcome, not a pipeline bug
  weak: { label: "weak", cls: "bg-muted text-wire ring-1 ring-line", loud: false },
  // loud: something in the pipeline under-delivered
  degraded: {
    label: "degraded",
    cls: "bg-pill-dismissed/15 text-pill-dismissed ring-1 ring-pill-dismissed/40",
    loud: true,
  },
  // loudest: terminal failure
  failed: { label: "failed", cls: "bg-pill-dismissed text-paper", loud: true },
};

/** The single source of truth for a run's feed badge. `health` may be null
 *  (older runs before 0031, or the column not existing yet — callers select it
 *  defensively and pass null on any read failure). */
export function runHealthBadge(
  status: string,
  health: RunHealth | null | undefined,
): RunBadge {
  // 1. Terminal failure ALWAYS wins — even over a stale/optimistic health blob.
  if (status === "failed") {
    return {
      kind: "failed",
      ...GRADE_STYLE.failed,
      notes: health?.notes ?? [],
      problem: true,
      weak: false,
    };
  }

  // 2. Still in flight — health is written only by the pipeline's final step.
  if (status === "queued" || status === "running") {
    const label = status;
    return {
      kind: status,
      label,
      cls: "bg-signal/15 text-signal ring-1 ring-signal/30",
      loud: false,
      notes: [],
      problem: false,
      weak: false,
    };
  }

  // 3. Done (or any other non-failed terminal state) with a persisted grade.
  if (health && health.grade) {
    const style = GRADE_STYLE[health.grade];
    return {
      kind: health.grade,
      ...style,
      notes: health.notes ?? [],
      problem: health.grade === "degraded" || health.grade === "failed",
      weak: health.grade === "weak",
    };
  }

  // 4. Done but no health row — be honest, never fake a derived grade.
  return {
    kind: "pre-health",
    label: "pre-health",
    cls: "bg-muted text-wire ring-1 ring-line",
    loud: false,
    notes: [],
    problem: false,
    weak: false,
  };
}

/** Feed filter: does this row pass the current toggles?
 *  - problemsOnly=false → everything shows.
 *  - problemsOnly=true  → only problems (degraded/failed/status=failed), PLUS
 *    weak rows when includeWeak is also on (weak is a separate, honestly-labeled
 *    product signal — not folded into "problems"). */
export function passesRunFilter(
  badge: RunBadge,
  opts: { problemsOnly: boolean; includeWeak: boolean },
): boolean {
  if (!opts.problemsOnly) return true;
  if (badge.problem) return true;
  if (opts.includeWeak && badge.weak) return true;
  return false;
}

/** artifacts n/N string from health, or null when unknown (pre-health). */
export function artifactsLabel(health: RunHealth | null | undefined): string | null {
  if (!health?.artifacts) return null;
  const { drafted, planned } = health.artifacts;
  return `${drafted}/${planned}`;
}
