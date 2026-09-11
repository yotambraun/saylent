// The spec (see METHODOLOGY.md) — sequential per engine (provider outage isolated),
// concurrency ≤3 within an engine, stage update per engine, hard cap on attempted
// calls ⇒ failRun (see METHODOLOGY.md).
//
// Adaptive sampling (migration 0033): SCORED questions are asked
// scoredSamples× per engine as the INITIAL draws (sample_idx 0..N-1, SEQUENTIAL
// per engine-question for politeness); a single adaptive TIEBREAK draw (sample_idx
// N, full depth — askTiebreakDraw) is taken later in the judge step ONLY when those
// initial draws don't already decide the majority-of-3 vote. observe only ASKS +
// returns the raw draws; the caller judges each draw, majority-votes the canonical
// answer, and persists (functions.ts judge step) — so observe writes NO answer rows
// itself (the canonical raw_text is the voted representative, unknown until judged).
import type { AskResult } from "./adapters";
import type { AnswerRow, BrandModel, DbWriter, Engine, Question } from "./types";

export const STAGE_LABELS: Record<Engine, string> = {
  chatgpt: "Asking ChatGPT",
  claude: "Asking Claude",
  gemini: "Asking Gemini",
  perplexity: "Asking Perplexity",
};

// Raised from 150 for sampling: the adaptive full-v2 WORST case (every scored
// question needing its tiebreak) = (12 scored ×3 + 11 ×1) ×4 engines = 188 draws
// — unchanged from the old flat 3×, since 2 initial + 1 tiebreak = 3. The typical
// run draws far fewer (2× on scored + only the disagreements). 200 keeps a real
// backstop against a call-storm bug while clearing the legitimate sampled maximum.
export const CALL_CAP = 200;

export type AskFn = (engine: Engine, question: string) => Promise<AskResult>;
/** How many draws to take for THIS question (profiles.sampleCountFor) — takes
 *  the whole Question, not just its qtype, so a per-question `samples`
 *  override (Samples feature) can win over the run-level default. */
export type SampleCountFn = (question: Question) => number;
/** One asked draw: an AnswerRow (pre-verdict) tagged with its 0-based draw index. */
export type DrawRow = AnswerRow & { sampleIdx: number };

/** engines × Σ draws-per-question, for whatever draw-count fn is passed. The
 *  call-cap guard passes profiles.maxDraws (the WORST case incl. the adaptive
 *  tiebreak) so the backstop budgets the maximum a run could ever attempt; the
 *  observe pass itself takes only the initial sampleCount draws (+ the few
 *  tiebreaks the judge step decides are informative). */
export function plannedDraws(
  questions: Question[],
  engines: Engine[],
  sampleCountFn: SampleCountFn,
): number {
  const perEngine = questions.reduce((s, q) => s + sampleCountFn(q), 0);
  return engines.length * perEngine;
}

/** tiny concurrency pool — no deps */
export async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
  return results;
}

/** Observe ONE engine (see METHODOLOGY.md). Asks each question
 *  sampleCountFn(qtype) times (draws 0..N-1, sequential per question for provider
 *  politeness) with ≤3 questions in flight. Returns the raw draws (no verdicts, no
 *  DB writes); the caller judges + votes + persists. sampleCountFn defaults to a
 *  single draw so non-sampling callers are unchanged. */
export async function observeEngine(
  engine: Engine,
  questions: Question[],
  _bm: BrandModel,
  ask: AskFn,
  db: DbWriter,
  runId: string,
  sampleCountFn: SampleCountFn = () => 1,
): Promise<DrawRow[]> {
  await db.setStage(runId, `${STAGE_LABELS[engine]} · 0/${questions.length} answered`);
  let done = 0;
  const perQuestion = await pool(questions, 3, async (q) => {
    const n = Math.max(1, sampleCountFn(q));
    const draws: DrawRow[] = [];
    for (let sampleIdx = 0; sampleIdx < n; sampleIdx++) {
      const r = await ask(engine, q.text); // sequential draws — one at a time per question
      draws.push({
        qid: q.qid,
        qtype: q.qtype,
        question: q.text,
        engine,
        sampleIdx,
        ok: r.ok,
        raw_text: r.text,
        citations: r.citations,
        ...(r.error ? { error: r.error } : {}),
        ...(r.usage ? { usage: r.usage } : {}),
      });
    }
    done++;
    await db.setStage(runId, `${STAGE_LABELS[engine]} · ${done}/${questions.length} answered`);
    return draws;
  });
  return perQuestion.flat();
}

/** Adaptive TIEBREAK draw: ask ONE more full-depth draw for a scored
 *  (qid, engine) group whose initial draws didn't decide the vote (needsTiebreak).
 *  Uses the SAME ask seam observeEngine uses (functions.ts binds it to the exact
 *  ADAPTERS call, full search depth). Tagged sampleIdx = group.length (draws
 *  0..n-1 are already taken, so a 2-draw group's tiebreak is sampleIdx 2). Returns
 *  the raw DrawRow (pre-verdict); the caller judges it exactly like an observe draw. */
export async function askTiebreakDraw(group: DrawRow[], ask: AskFn): Promise<DrawRow> {
  const base = group[0];
  const r = await ask(base.engine, base.question);
  return {
    qid: base.qid,
    qtype: base.qtype,
    question: base.question,
    engine: base.engine,
    sampleIdx: group.length,
    ok: r.ok,
    raw_text: r.text,
    citations: r.citations,
    ...(r.error ? { error: r.error } : {}),
    ...(r.usage ? { usage: r.usage } : {}),
  };
}

/** Full observe pass (used outside Inngest, e.g. tests): enforces the call cap
 *  against the true draw count. Single-sample by default. */
export async function observe(
  questions: Question[],
  bm: BrandModel,
  ask: AskFn,
  db: DbWriter,
  runId: string,
  engines: Engine[] = ["chatgpt", "claude", "gemini", "perplexity"],
  sampleCountFn: SampleCountFn = () => 1,
): Promise<DrawRow[] | null> {
  if (plannedDraws(questions, engines, sampleCountFn) > CALL_CAP) {
    await db.failRun(runId, "internal call-cap guard");
    return null;
  }
  const all: DrawRow[] = [];
  for (const engine of engines) {
    all.push(...(await observeEngine(engine, questions, bm, ask, db, runId, sampleCountFn)));
  }
  return all;
}
