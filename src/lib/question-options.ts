// App/CLI parity for run control.
// This is the PURE half of /app/brand/[id]/questions: the same validation the CLI
// applies to a `--questions` file (packages/cli/src/questions-file.ts
// fromQuestionRows), the run-level options the CLI takes as flags
// (--samples/--engines/--locale/--skip-*), the pre-spend cost estimate, and the
// one mapping that turns a stored option blob into the fields runAudit reads.
//
// WHY A PORT AND NOT AN IMPORT: @saylent/cli is not a dependency of the app (the
// app must build without the CLI installed), so the ~40 lines of pure row
// validation are ported here and pinned by questions-file-parity tests below the
// fold in question-options.test.ts. The engine IS a dependency, so everything
// that lives there (question types, ENGINE_FLOOR, sample bounds, per-answer cost
// rates) is imported, never copied.
//
// PURE by contract: no Next, no Supabase, no node builtins, and no import that
// drags the crawler in — the client form imports this module directly so the
// estimate recomputes on every keystroke in the browser.
import { COST_CENTS, type CostEngine } from "@saylent/engine/answer-cost";
import { ALL_ENGINES, ENGINE_FLOOR, resolveEngines } from "@saylent/engine/engines";
import { MAX_SAMPLES, MIN_SAMPLES, PROFILES, type ProfileName } from "@saylent/engine/profiles";
import type { QType, Question, SkipStages } from "@saylent/engine/types";

/** The shipped question types (engine types.ts QType). "custom" is what an
 *  untagged user question gets — asked and judged, never scored. Ported from
 *  packages/cli/src/questions-file.ts QUESTION_TYPES. */
export const QUESTION_TYPES = [
  "category",
  "comparison",
  "problem",
  "branded",
  "integration",
  "migration",
  "trust",
  "custom",
] as const satisfies readonly QType[];
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** The only types that count toward the score and the recommended band (engine
 *  score.ts SCORED). Everything else — every custom row included — is asked,
 *  judged and reported, and deliberately excluded, so a user's own questions can
 *  never inflate their own band. */
export const SCORED_TYPES: readonly QuestionType[] = ["category", "problem"];

/** true when a row of this type moves the recommended band. */
export function isBandCounted(type: string): boolean {
  return (SCORED_TYPES as readonly string[]).includes(type);
}

/** Hard ceiling on an edited set. The full profile generates 23; the cap exists
 *  so a stray paste cannot quietly turn one audit into a hundred dollars. */
export const MAX_QUESTIONS = 50;
/** Longest question text we will send to an answer engine. */
export const MAX_QUESTION_CHARS = 300;

/** One editable row, as stored in brands.run_options.questions. Field names match
 *  the CLI's questions.json rows (id/type/text/source/samples) so a set can move
 *  between the app and `saylent audit --questions` unchanged. */
export interface DraftQuestion {
  id: string;
  type: QuestionType;
  text: string;
  source: "template" | "user";
  /** per-question draw count (1-5); wins over the run-level count for this row */
  samples?: number;
}

/** Which stages a run may skip: the engine's own SkipStages, aliased so this
 *  module reads on its own terms. Type-only, so nothing from the engine's
 *  runtime graph reaches the browser bundle. */
export type RunSkipOptions = SkipStages;

/** brands.run_options (migration 0043) — everything the user chose before
 *  spending. Every field optional: an absent field means "the default", exactly
 *  as an omitted CLI flag does. */
export interface RunOptions {
  questions?: DraftQuestion[];
  samples?: number;
  engines?: string[];
  locale?: string;
  skip?: RunSkipOptions;
  updated_at?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const isType = (value: unknown): value is QuestionType =>
  typeof value === "string" && (QUESTION_TYPES as readonly string[]).includes(value);

const clampSamples = (n: number): number =>
  Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, Math.round(n)));

/** A draft question `id` was taken from the form verbatim and
 *  never bounded. It is stored in brands.run_options / runs.run_options, echoed
 *  into the frozen question envelope, keyed on in the bundle, printed in the
 *  report and used in filenames and DOM ids downstream — so an unbounded,
 *  arbitrary-character string is both a storage-bloat vector (thousands of
 *  characters per row) and an injection surface everywhere it is interpolated.
 *  The shape below is exactly what the generator produces (q01, q02, …) plus
 *  room for a hand-written id. */
export const MAX_QUESTION_ID_CHARS = 32;
export const QUESTION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Null when the id is fine; otherwise the message the form shows. */
export function questionIdError(id: string): string | null {
  if (id.length > MAX_QUESTION_ID_CHARS) {
    return `A question id is capped at ${MAX_QUESTION_ID_CHARS} characters. One is ${id.length}.`;
  }
  if (!QUESTION_ID_PATTERN.test(id)) {
    return `Question ids may only use letters, numbers, "-" and "_". "${id.slice(0, MAX_QUESTION_ID_CHARS)}" does not.`;
  }
  return null;
}

/** q01, q02, … — the next free id after everything already claimed. Ported from
 *  packages/cli/src/questions-file.ts idAssigner. */
function idAssigner(taken: Set<string>): () => string {
  let n = 0;
  return () => {
    let id: string;
    do {
      n += 1;
      id = `q${String(n).padStart(2, "0")}`;
    } while (taken.has(id));
    taken.add(id);
    return id;
  };
}

/**
 * Validate + normalize the rows the form posted, with the CLI's rules:
 *  - a row with no `text` is rejected (never silently dropped);
 *  - a row with no/unknown `type` becomes "custom" — asked and judged, excluded
 *    from the band;
 *  - a row with no `id` gets the next free q-number, and a supplied `id` must be
 *    <= 32 chars of [A-Za-z0-9_-] (questionIdError);
 *  - `samples` must be a whole number 1-5.
 * Anything the user typed is marked source:"user", so the run bundle records
 * whose question it was and a smoke run asks it rather than dropping it.
 */
export function normalizeDraftQuestions(rows: unknown[]): Result<DraftQuestion[]> {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: "A run needs at least one question." };
  }
  if (rows.length > MAX_QUESTIONS) {
    return { ok: false, error: `That is ${rows.length} questions. The most one run can ask is ${MAX_QUESTIONS}.` };
  }
  const taken = new Set<string>();
  for (const row of rows) {
    const id = (row as { id?: unknown })?.id;
    if (typeof id === "string" && id) {
      // #16: bound it HERE too — a rejected id must never reach `taken` and so
      // never influence which id the assigner hands out.
      const bad = questionIdError(id);
      if (bad) return { ok: false, error: bad };
      taken.add(id);
    }
  }
  const nextId = idAssigner(taken);
  const out: DraftQuestion[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") return { ok: false, error: "Every question needs text." };
    const r = row as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text.replace(/\s+/g, " ").trim() : "";
    if (!text) return { ok: false, error: "Every question needs text. Remove the empty row or fill it in." };
    if (text.length > MAX_QUESTION_CHARS) {
      return { ok: false, error: `Questions are capped at ${MAX_QUESTION_CHARS} characters. One row is ${text.length}.` };
    }
    const rawType = typeof r.type === "string" ? r.type : "";
    const type: QuestionType = isType(rawType) ? rawType : "custom";
    const id = typeof r.id === "string" && r.id ? r.id : nextId();
    const source: "template" | "user" = r.source === "template" ? "template" : "user";
    let samples: number | undefined;
    if (r.samples !== undefined && r.samples !== null && r.samples !== "") {
      const n = typeof r.samples === "number" ? r.samples : Number(r.samples);
      if (!Number.isInteger(n) || n < MIN_SAMPLES || n > MAX_SAMPLES) {
        return { ok: false, error: `"${id}" samples must be a whole number ${MIN_SAMPLES}-${MAX_SAMPLES}.` };
      }
      samples = n;
    }
    out.push({ id, type, text, source, ...(samples !== undefined ? { samples } : {}) });
  }
  return { ok: true, value: out };
}

/** BCP47-ish tag, the same shape `saylent audit --locale` accepts. */
export const LOCALE_PATTERN = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

/** Validate the whole option blob a form posted. Returns exactly what belongs in
 *  brands.run_options: absent fields are dropped, never stored as null. */
export function normalizeRunOptions(input: {
  questions?: unknown[] | null;
  samples?: unknown;
  engines?: unknown;
  locale?: unknown;
  skip?: RunSkipOptions | null;
  now?: string;
}): Result<RunOptions> {
  const out: RunOptions = {};

  if (input.questions != null) {
    const rows = normalizeDraftQuestions(input.questions);
    if (!rows.ok) return rows;
    out.questions = rows.value;
  }

  if (input.samples !== undefined && input.samples !== null && input.samples !== "") {
    const n = typeof input.samples === "number" ? input.samples : Number(input.samples);
    if (!Number.isInteger(n) || n < MIN_SAMPLES || n > MAX_SAMPLES) {
      return { ok: false, error: `Samples per question must be a whole number ${MIN_SAMPLES}-${MAX_SAMPLES}.` };
    }
    out.samples = n;
  }

  if (input.engines != null) {
    const raw = Array.isArray(input.engines) ? input.engines.map(String) : [];
    const valid = ALL_ENGINES.filter((e) => raw.includes(e));
    if (valid.length > 0 && valid.length < ENGINE_FLOOR) {
      return {
        ok: false,
        error: `Choose at least ${ENGINE_FLOOR} engines — a single engine can't cross-check the verdict.`,
      };
    }
    // All four is the default: store nothing rather than a redundant array.
    if (valid.length > 0 && valid.length < ALL_ENGINES.length) out.engines = [...valid];
  }

  if (input.locale != null && String(input.locale).trim() !== "") {
    const tag = String(input.locale).trim();
    if (!LOCALE_PATTERN.test(tag)) {
      return { ok: false, error: `"${tag}" is not a language tag. Use something like de or pt-BR.` };
    }
    out.locale = tag;
  }

  const skip = input.skip ?? undefined;
  if (skip && (skip.drafts || skip.corpus || skip.gates)) {
    out.skip = {
      ...(skip.drafts ? { drafts: true } : {}),
      ...(skip.corpus ? { corpus: true } : {}),
      ...(skip.gates ? { gates: true } : {}),
    };
  }

  out.updated_at = input.now ?? new Date().toISOString();
  return { ok: true, value: out };
}

/** Draft rows → the engine's Question shape (qid/qtype), which is what a frozen
 *  envelope and `--questions` both carry. */
export function toEngineQuestions(rows: DraftQuestion[]): Question[] {
  return rows.map((r) => ({
    qid: r.id,
    text: r.text,
    qtype: r.type,
    source: r.source,
    ...(r.samples !== undefined ? { samples: r.samples } : {}),
  }));
}

/** Engine Question rows → editable draft rows (the reverse, for seeding the form
 *  from a generated or frozen set). */
export function toDraftQuestions(questions: readonly Question[]): DraftQuestion[] {
  return questions.map((q) => {
    const row = q as Question & { source?: string; samples?: number };
    return {
      id: q.qid,
      type: (isType(q.qtype) ? q.qtype : "custom") as QuestionType,
      text: q.text,
      source: row.source === "user" ? ("user" as const) : ("template" as const),
      ...(row.samples !== undefined ? { samples: row.samples } : {}),
    };
  });
}

/** true when the edited draft would ask a different set than the baseline — the
 *  trigger for the "verify will compare against a new baseline" warning and for
 *  clearing the frozen envelope. Text, type, order and per-question samples all
 *  count; the row id does not (a re-numbered but identical set is the same set). */
export function questionsChanged(
  baseline: readonly DraftQuestion[],
  draft: readonly DraftQuestion[],
): boolean {
  const key = (rows: readonly DraftQuestion[]) =>
    rows.map((r) => `${r.type} ${r.text} ${r.samples ?? ""}`).join("");
  return key(baseline) !== key(draft);
}

// ---------------------------------------------------------------------------
// Cost estimate — the number shown before "Run audit"
// ---------------------------------------------------------------------------

/** The per-CALL rates for the non-answer roles. MIRRORS ROLE_COST_CENTS in
 *  @saylent/engine/run-audit, which cannot be imported here: run-audit pulls the
 *  crawler (cheerio, DNS-guarded fetch) into whatever imports it, and this
 *  estimate has to run in the browser on every keystroke. question-options.test.ts
 *  asserts these stay byte-identical to the engine's, so drift fails the suite. */
export const ROLE_CENTS = { judge: 0.4, drafter: 2.5, brand: 2 } as const;

export interface CostEstimate {
  lowUsd: number;
  highUsd: number;
  /** answer draws at the low end (no adaptive tiebreak fires) */
  drawsLow: number;
  /** answer draws at the high end (every 2-sample group needs its tiebreak) */
  drawsHigh: number;
  /** how many ASKED rows can move the recommended band */
  scored: number;
  /** rows this profile asks (smoke asks six of the set) */
  asked: number;
  /** rows in the set */
  total: number;
  /** engines actually asked */
  engines: number;
}

/** The effective draw count for one row: an explicit per-question override wins;
 *  otherwise scored rows get the run-level count and everything else gets 1
 *  (engine profiles.ts sampleCountFor). */
export function drawsForQuestion(q: { type: string; samples?: number }, runSamples: number): number {
  if (q.samples !== undefined) return clampSamples(q.samples);
  return isBandCounted(q.type) ? clampSamples(runSamples) : 1;
}

/**
 * What this run will cost, before it is spent. Same shape of arithmetic as the
 * CLI preflight (packages/cli/src/preflight.ts estimateCostRange) with two
 * refinements the app can afford because it knows the exact set:
 *  - draws are counted per question and per selected engine, at that engine's own
 *    rate, instead of a blended min/max rate;
 *  - the high end adds the adaptive tiebreak only for groups whose effective
 *    count is exactly 2 (the only case that can trigger one).
 * `skip.drafts` removes the drafter calls; skipping the corpus or the gate checks
 * costs no model call either way, so neither moves this number.
 */
export function estimateRunCost(p: {
  questions: readonly EstimateRow[];
  engines: readonly string[];
  samples: number;
  skip?: RunSkipOptions | null;
  profile?: ProfileName;
}): CostEstimate {
  const engines = resolveEngines([...p.engines]);
  const profile = p.profile ?? "full";
  const caps = PROFILES[profile];
  // Price what the run will ASK, not the whole frozen set: a smoke run asks six
  // of the frozen questions (engine profiles.ts selectQuestions), so pricing all
  // 23 quoted a ~$2.50 smoke run that actually costs about $0.93.
  const asked = askedForProfile(p.questions, profile);
  let perEngineLow = 0;
  let perEngineHigh = 0;
  let scored = 0;
  for (const q of asked) {
    const n = drawsForQuestion(q, p.samples);
    perEngineLow += n;
    perEngineHigh += n === 2 ? 3 : n; // the tiebreak is only ever asked at n=2
    if (isBandCounted(q.type)) scored += 1;
  }
  const rateSum = engines.reduce((s, e) => s + (COST_CENTS[e as CostEngine] ?? 0), 0);
  const drawsLow = perEngineLow * engines.length;
  const drawsHigh = perEngineHigh * engines.length;
  const answerLow = perEngineLow * rateSum;
  const answerHigh = perEngineHigh * rateSum;
  // Judging: one call per answer at worst; roughly half that when engines agree
  // on the easy ones (the CLI preflight uses the same 0.5 factor for its floor).
  const overheadLow = ROLE_CENTS.brand + ROLE_CENTS.judge * drawsLow * 0.5;
  const overheadHigh =
    ROLE_CENTS.brand +
    ROLE_CENTS.judge * drawsHigh +
    (p.skip?.drafts ? 0 : ROLE_CENTS.drafter * caps.draftTop);
  return {
    lowUsd: Math.round(answerLow + overheadLow) / 100,
    highUsd: Math.round(answerHigh + overheadHigh) / 100,
    drawsLow,
    drawsHigh,
    scored,
    asked: asked.length,
    total: p.questions.length,
    engines: engines.length,
  };
}

export interface EstimateRow {
  type: string;
  samples?: number;
  /** "user" marks a row the operator typed; a smoke run always asks those */
  source?: string;
}

/**
 * The rows a run on this profile actually asks. Mirrors the engine exactly
 * (run-audit.ts selectForProfile over profiles.ts selectQuestions): a full run
 * asks the whole set; a smoke run asks the first row of each type in the order
 * category, comparison, problem, branded, then fills to the smoke budget with
 * the next category and comparison rows. Rows the operator typed (`source:
 * "user"`) are always asked on smoke and the template selection fills the rest.
 * Kept here as a port (not an import) for the same reason as the row validation:
 * the client form must not drag run-audit.ts into the browser bundle.
 */
export function askedForProfile<T extends EstimateRow>(rows: readonly T[], profile: ProfileName): T[] {
  if (profile === "full") return [...rows];
  const budget = PROFILES.smoke.questions;
  const authored = rows.filter((r) => r.source === "user");
  const templated = rows.filter((r) => r.source !== "user");
  const picked: T[] = [];
  for (const t of ["category", "comparison", "problem", "branded"]) {
    const first = templated.find((r) => r.type === t);
    if (first) picked.push(first);
  }
  for (const t of ["category", "comparison"]) {
    if (picked.length >= budget) break;
    const next = templated.find((r) => r.type === t && !picked.includes(r));
    if (next) picked.push(next);
  }
  const room = Math.max(0, budget - authored.length);
  return [...authored, ...picked.slice(0, room)];
}

/** "$4.10 to $8.60" / "$4.10" when the range collapses. */
export function formatUsdRange(e: Pick<CostEstimate, "lowUsd" | "highUsd">): string {
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  return e.lowUsd === e.highUsd ? fmt(e.lowUsd) : `${fmt(e.lowUsd)} to ${fmt(e.highUsd)}`;
}

// ---------------------------------------------------------------------------
// The mapping into RunAuditInput
// ---------------------------------------------------------------------------

export interface FrozenEnvelope {
  questions?: Question[];
  version?: number;
  engines?: string[];
}

/** Exactly the RunAuditInput fields these options decide. src/inngest/functions.ts
 *  spreads this onto the input it hands runAudit, so the mapping itself is pure
 *  and testable without Inngest, Supabase or a single model call. */
export interface MappedRunInput {
  questionSet: FrozenEnvelope | null;
  questionSetVersion: number;
  engines: string[] | null;
  samples: number | null;
  locale: string | null;
  skip: RunSkipOptions | null;
  /** true when the edited draft is what this run will ask (so the caller knows it
   *  has to persist the frozen envelope itself — runAudit only calls
   *  hooks.onQuestionSet for a set it generated) */
  suppliedQuestions: boolean;
}

/**
 * Turn a stored option blob into the run's input, the way the CLI's run.ts does:
 *  - an edited set is passed as `questionSet`, so runAudit reuses it verbatim —
 *    the same path `--questions` takes;
 *  - the engine subset is frozen INSIDE that envelope, so a later verify reuses
 *    the exact set of engines this audit asked;
 *  - `locale` only means anything when a set is freshly generated (the CLI says
 *    "no effect: --questions reuses a set verbatim"), so it is dropped as soon as
 *    the draft supplies questions;
 *  - a VERIFY ignores run options completely and reuses the frozen baseline, or
 *    it would be comparing two different runs.
 */
export function runInputFromOptions(p: {
  kind: "audit" | "verify";
  runOptions: RunOptions | null | undefined;
  brandEngines: string[] | null;
  brandQuestionSet: FrozenEnvelope | null;
  brandQuestionSetVersion: number;
}): MappedRunInput {
  const version = p.brandQuestionSetVersion || 1;
  if (p.kind === "verify") {
    return {
      questionSet: p.brandQuestionSet,
      questionSetVersion: version,
      engines: p.brandEngines,
      samples: null,
      locale: null,
      skip: null,
      suppliedQuestions: false,
    };
  }
  const opts = p.runOptions ?? {};
  const engines = opts.engines?.length ? opts.engines : p.brandEngines;
  const edited = opts.questions?.length ? opts.questions : null;
  const questionSet: FrozenEnvelope | null = edited
    ? { questions: toEngineQuestions(edited), version, engines: resolveEngines(engines) }
    : p.brandQuestionSet;
  return {
    questionSet,
    questionSetVersion: version,
    engines: engines ?? null,
    samples: opts.samples ?? null,
    locale: edited ? null : (opts.locale ?? null),
    skip: opts.skip ?? null,
    suppliedQuestions: !!edited,
  };
}
