// Run-health "birth certificate" contract — the admin quality system. WRITTEN
// once by the pipeline's final step into runs.health; READ by the operator
// console (/admin/runs). Persisted — not
// derived at read time — so the grade forever reflects the code that produced
// the run. Keep this file dependency-free (types + pure grading only): it is
// imported by both the Inngest pipeline and admin server components.

export type RunHealthGrade = "ok" | "weak" | "degraded" | "failed";

export type RunHealth = {
  /** contract version, bump on shape changes */
  v: 1;
  grade: RunHealthGrade;
  /** answers received vs expected, per engine (expected from the run profile) */
  answers: Record<string, { got: number; expected: number }>;
  /** judged answers whose citations array came back empty (channel-drop smell) */
  zero_citation_answers: number;
  /** judge outputs that failed to parse and used the fallback — HEURISTIC estimate
   *  from verdict shape (run-health-build), kept as belt-and-braces + the grade input */
  judge_parse_failures: number;
  /** the REAL parse-failure count reported by the judge itself (parsed:false after
   *  retry), stamped by the pipeline on the success path. Optional: absent on the
   *  failure path and on older runs, where only the heuristic is available. */
  judge_parse_failures_actual?: number;
  corpus: { fetched: number; fetch_failures: number; thin: number };
  /** the flagship deliverable check: top-N fixes that should carry an artifact
   *  vs how many actually do (the missing-artifact bug detector) */
  artifacts: { planned: number; drafted: number };
  /** weak result per the dossier's own rule (recommended <10% of scored) */
  weak_result: boolean;
  est_cost_usd: number | null;
  duration_s: number | null;
  /** honest notes for the operator, one line per anomaly */
  notes: string[];
};

/** Grade rules (deterministic, unit-test these in the writer):
 *  failed   — run errored terminally (status failed) or 0 answers overall
 *  degraded — any engine that delivered under HALF its expected answers
 *             (got=0 included; a paid run with a mostly-dead engine is not
 *             "ok" — proven by a real full run where one engine answered
 *             6/20 under free-tier throttling), OR artifacts.drafted <
 *             artifacts.planned, OR judge_parse_failures > 0, OR
 *             zero_citation_answers > 20% of judged answers
 *  weak     — pipeline healthy but weak_result (a product outcome, not a bug)
 *  ok       — none of the above */
export function gradeRunHealth(h: Omit<RunHealth, "grade" | "v">): RunHealthGrade {
  const engines = Object.values(h.answers);
  const totalGot = engines.reduce((s, e) => s + e.got, 0);
  if (totalGot === 0) return "failed";
  const judged = totalGot;
  if (
    engines.some((e) => e.expected > 0 && e.got < e.expected / 2) ||
    h.artifacts.drafted < h.artifacts.planned ||
    h.judge_parse_failures > 0 ||
    (judged > 0 && h.zero_citation_answers / judged > 0.2)
  ) {
    return "degraded";
  }
  if (h.weak_result) return "weak";
  return "ok";
}
