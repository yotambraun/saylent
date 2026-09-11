// Pure assembly of the run-health "birth certificate" (contract: src/lib/run-health.ts).
// Extracted from the pipeline so the arithmetic + grading is unit-testable in
// isolation: NO Next/Supabase deps. The Inngest final/failure step (and the
// admin real-data validation script) feed it already-digested row counts; this
// file does the deterministic math + notes, then calls gradeRunHealth.
import { gradeRunHealth, type RunHealth } from "./run-health";

// Kept in lockstep with @saylent/engine's fixes.ts draftArtifacts: the placeholder text a
// failed drafter writes, and the coverage-hub key that always claims a draft slot.
// Duplicated (not imported) so this pure helper stays free of engine deps; if
// fixes.ts changes either, update here too.
export const ARTIFACT_FAILURE_PREFIX = "[Artifact drafting failed";
const COVERAGE_HUB_KEY = "coverage-hub";

export interface HealthVerdictInput {
  brand_present: boolean;
  mention_type: string;
  prominence: string;
  sentiment: string;
  /** verdict.claims.length */
  claims: number;
  /** verdict.other_brands.length */
  other_brands: number;
}

export interface HealthAnswerInput {
  qid: string;
  engine: string;
  ok: boolean;
  /** citations.length (the channel-drop smell reads empty === 0) */
  citations: number;
  verdict: HealthVerdictInput | null;
}

export interface HealthFixInput {
  fixKey: string;
  weight: number;
  artifact: string | null;
}

export interface HealthCorpusInput {
  fetch_status: number | null;
  thin: boolean;
}

export interface HealthScoresInput {
  answered: number;
  recommended: number;
  rec_rate: number | null;
}

export interface BuildRunHealthInputs {
  status: "done" | "failed";
  /** weak_result reuses the dossier's audit-only rule; verify runs never grade weak */
  isAudit: boolean;
  /** the frozen answer-engine set the run asked (source of truth: catches a fully-dead engine
   *  that saved 0 rows, which would otherwise be invisible) */
  engines: string[];
  answers: HealthAnswerInput[];
  fixes: HealthFixInput[];
  /** the profile's draftTop — the number of draft slots (PROFILES[profile].draftTop) */
  draftTop: number;
  corpus: HealthCorpusInput[];
  scores: HealthScoresInput | null;
  estCostUsd: number | null;
  durationS: number | null;
}

const isRealArtifact = (a: string | null): boolean =>
  !!a && a.trim().length > 0 && !a.startsWith(ARTIFACT_FAILURE_PREFIX);

/** Replicates src/engine/fixes.ts draftArtifacts slot selection: the coverage-hub
 *  always claims a slot when present, then the highest-weight fixes fill to draftTop.
 *  Returns the SELECTED fixes (the "planned" set). */
function selectedDraftSlots(fixes: HealthFixInput[], draftTop: number): HealthFixInput[] {
  const sorted = [...fixes].sort((a, b) => b.weight - a.weight);
  const selected = new Set<HealthFixInput>();
  const hub = sorted.find((f) => f.fixKey === COVERAGE_HUB_KEY);
  if (hub) selected.add(hub);
  for (const f of sorted) {
    if (selected.size >= draftTop) break;
    selected.add(f);
  }
  return [...selected];
}

/** The fallback verdict shape buildVerdict() returns when the judge output failed
 *  to parse (judgeJson === null) AND the brand is present: neutral / buried /
 *  neutral with zero claims and zero other_brands. HEURISTIC — there is no
 *  persisted parse-failure counter, and an ABSENT-brand fallback is byte-identical
 *  to a valid absent verdict (the code forces mention_type=absent either way), so
 *  we only flag PRESENT-brand fallbacks. Conservative on purpose: false positives
 *  would spuriously mark healthy runs degraded (judge_parse_failures > 0 rule). */
function isJudgeFallback(v: HealthVerdictInput | null): boolean {
  return (
    !!v &&
    v.brand_present &&
    v.mention_type === "neutral" &&
    v.prominence === "buried" &&
    v.sentiment === "neutral" &&
    v.claims === 0 &&
    v.other_brands === 0
  );
}

export function buildRunHealth(inp: BuildRunHealthInputs): RunHealth {
  const notes: string[] = [];

  // expected per engine = distinct questions actually asked this run (every
  // (engine,question) saves a row, so the union of qids IS the asked question set).
  const expected = new Set(inp.answers.map((a) => a.qid)).size;
  const answers: RunHealth["answers"] = {};
  for (const engine of inp.engines) {
    const got = inp.answers.filter((a) => a.engine === engine && a.ok).length;
    answers[engine] = { got, expected };
    if (got === 0 && expected > 0) {
      notes.push(`engine ${engine} returned 0 of ${expected} answers (dead engine)`);
    } else if (expected > 0 && got < expected / 2) {
      // Contract rule: an engine under half its expected answers degrades the
      // run (observed on a real full run: one engine answered only 6/20 under
      // free-tier throttling).
      notes.push(`engine ${engine} returned only ${got} of ${expected} answers (partial engine)`);
    }
  }

  const okAnswers = inp.answers.filter((a) => a.ok);
  const zero_citation_answers = okAnswers.filter((a) => a.citations === 0).length;
  const judge_parse_failures = okAnswers.filter((a) => isJudgeFallback(a.verdict)).length;
  if (judge_parse_failures > 0) {
    notes.push(
      `${judge_parse_failures} judged answer${judge_parse_failures > 1 ? "s" : ""} fell back to a neutral verdict (judge parse failure, heuristic)`,
    );
  }
  const judged = okAnswers.length;
  if (judged > 0 && zero_citation_answers / judged > 0.2) {
    notes.push(`${zero_citation_answers}/${judged} judged answers carried no citations (channel drop)`);
  }

  const fetched = inp.corpus.filter(
    (c) => c.fetch_status !== null && c.fetch_status >= 200 && c.fetch_status < 400,
  ).length;
  const fetch_failures = inp.corpus.length - fetched;
  const thin = inp.corpus.filter((c) => c.thin).length;
  if (fetch_failures > 0) notes.push(`${fetch_failures} cited page${fetch_failures > 1 ? "s" : ""} failed to fetch (unverified)`);
  if (thin > 0) notes.push(`${thin} cited page${thin > 1 ? "s" : ""} are thin / JS-shell (engines may not read them)`);

  const selected = selectedDraftSlots(inp.fixes, inp.draftTop);
  const planned = selected.length;
  const drafted = selected.filter((f) => isRealArtifact(f.artifact)).length;
  if (drafted < planned) {
    notes.push(
      `${planned - drafted} of ${planned} planned fix artifact${planned - drafted > 1 ? "s" : ""} did not draft (artifact starvation)`,
    );
  }

  const recPct = Math.round((inp.scores?.rec_rate ?? 0) * 100);
  const weak_result = inp.isAudit && (inp.scores?.answered ?? 0) > 0 && recPct < 10;
  if (weak_result) notes.push(`recommended in <10% of scored answers (weak result)`);

  if (inp.status === "failed") notes.push("run terminated in a failed state");

  const body: Omit<RunHealth, "grade" | "v"> = {
    answers,
    zero_citation_answers,
    judge_parse_failures,
    corpus: { fetched, fetch_failures, thin },
    artifacts: { planned, drafted },
    weak_result,
    est_cost_usd: inp.estCostUsd,
    duration_s: inp.durationS,
    notes,
  };

  // Failure path grades "failed" with whatever is known; otherwise the deterministic rules.
  const grade = inp.status === "failed" ? "failed" : gradeRunHealth(body);
  return { v: 1, grade, ...body };
}
