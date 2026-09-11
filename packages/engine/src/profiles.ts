// The spec (see METHODOLOGY.md) — ONE config object, read everywhere caps apply
// (no scattered ifs). Profile is stamped on runs.profile at createRun time;
// the Inngest function reads the run row's profile, never the env again.
import type { SamplingConfig } from "./config";
import { isScored } from "./score";
import type { QType, Question, SkipStages } from "./types";

export const MIN_SAMPLES = 1;
export const MAX_SAMPLES = 5;
const clampSamples = (n: number): number => Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, Math.round(n)));

export const PROFILES = {
  // draftTop raised E2b (full 3→5, smoke 1→2): schema_missing & entity_unclear
  // never drafted at 3 (source pitches crowded them out); +2 drafter calls ≈ +5¢
  // full, +1 ≈ +2.5¢ smoke (PROVIDERS.md drafter ≈2.5¢/artifact).
  //
  // ADAPTIVE SAMPLING (project rule: "cut cost, ZERO quality loss"):
  // each SCORED question (category|problem) is asked scoredSamples× per engine as
  // the INITIAL draws, then — only when scoredTiebreak is on — ONE more draw is
  // taken iff those initial draws don't already decide the majority-of-3 vote
  // (they disagree or one failed). With majority-of-3, two agreeing draws ARE the
  // majority regardless of a third, so the tiebreak is asked ONLY when informative:
  // this is VOTE-IDENTICAL to always asking 3× (migration 0033) at ~⅓ fewer scored
  // draws. full = 2 initial + adaptive tiebreak (was a flat 3×, which measured
  // $8.45 on one real run);
  // smoke STAYS 1× tiebreak OFF (the $0.5 pipeline-test cost is unchanged). Every
  // draw keeps full search depth; non-scored qtypes are always single-sample.
  full: { questions: 23, corpusTop: 60, crawlPages: 25, draftTop: 5, judgeConcurrency: 6, claudeMaxSearches: 2, scoredSamples: 2, scoredTiebreak: true },
  smoke: { questions: 6, corpusTop: 12, crawlPages: 8, draftTop: 2, judgeConcurrency: 6, claudeMaxSearches: 1, scoredSamples: 1, scoredTiebreak: false },
} as const;

export type ProfileName = keyof typeof PROFILES;

/** INITIAL draws to take for one (engine, question) on this profile: scored
 *  questions get PROFILES[profile].scoredSamples (full 2, smoke 1); every other
 *  qtype is single-sample. The observe pass reads this; the adaptive tiebreak (a
 *  possible +1 on scored, tiebreak-on profiles) is decided later in the judge step
 *  from the actual draws — see maxDraws for the call-cap worst case. */
export function sampleCount(qtype: QType, profile: ProfileName): number {
  return isScored(qtype) ? PROFILES[profile].scoredSamples : 1;
}

/** WORST-CASE draws for one (engine, question) INCLUDING a possible tiebreak —
 *  the number the CALL_CAP backstop must budget for. A scored question on a
 *  tiebreak-on profile can reach scoredSamples + 1 (the single adaptive tiebreak
 *  draw); everything else equals sampleCount. Worst case is unchanged from the old
 *  flat 3× (2 + 1 = 3), so the call-cap headroom is preserved. */
export function maxDraws(qtype: QType, profile: ProfileName): number {
  const p = PROFILES[profile];
  if (!isScored(qtype)) return 1;
  return p.scoredSamples + (p.scoredTiebreak ? 1 : 0);
}

/** the spec (see METHODOLOGY.md) smoke selection — deterministic: FIRST of each qtype in order
 *  (category, comparison, problem, branded), then fill to 6 with the next
 *  category + comparison questions. The frozen set itself is NEVER altered. */
export function selectQuestions(frozen: Question[], profile: ProfileName): Question[] {
  if (profile === "full") return frozen;
  const order: QType[] = ["category", "comparison", "problem", "branded"];
  const picked: Question[] = [];
  for (const t of order) {
    const first = frozen.find((q) => q.qtype === t);
    if (first) picked.push(first);
  }
  for (const t of ["category", "comparison"] as QType[]) {
    if (picked.length >= PROFILES.smoke.questions) break;
    const next = frozen.find((q) => q.qtype === t && !picked.includes(q));
    if (next) picked.push(next);
  }
  return picked.slice(0, PROFILES.smoke.questions);
}

// ---------------------------------------------------------------------------
// Samples feature: the operator controls how many times each question is
// asked. RUN LEVEL (this section) resolves ONE number for the run — the
// per-question override (Question.samples, sampleCountFor below) wins over it
// for that single question, exactly the same way selectForProfile lets a
// user-authored question opt out of the profile's own picking rule.
// ---------------------------------------------------------------------------

export type SamplingSource = "flag" | "env" | "config" | "profile";

export interface ResolvedSampling {
  /** the effective run-level draw count for a scored question with no
   *  per-question override (1-5) */
  samples: number;
  /** true only when `samples` is exactly 2: a group whose EFFECTIVE draw
   *  count is 2 gets ONE more draw on disagreement (the historical adaptive
   *  tiebreak). Always false for 1 (no vote possible) and for 3-5 (a vote is
   *  already decided over every draw) — `sampling.tiebreak` can only turn the
   *  n=2 case off, never force a tiebreak on for another count. */
  tiebreak: boolean;
  /** which layer supplied `samples`, for an honest preflight/defaults line */
  source: SamplingSource;
}

/** Run-level sampling resolution: `--samples` flag > `AUDIT_SAMPLES` env >
 *  saylent.config `sampling.samples` > the profile default
 *  (PROFILES[profile].scoredSamples). Throws a clear error on an explicit
 *  flag/env value that isn't a whole number 1-5 (config is already schema
 *  -validated at load time); never silently ignores a bad override. */
export function resolveSampling(
  profile: ProfileName,
  opts: { flag?: number; env?: string; config?: SamplingConfig | null } = {},
): ResolvedSampling {
  let samples: number;
  let source: SamplingSource;
  if (opts.flag !== undefined) {
    if (!Number.isFinite(opts.flag) || !Number.isInteger(opts.flag) || opts.flag < MIN_SAMPLES || opts.flag > MAX_SAMPLES) {
      throw new Error(`--samples ${opts.flag}: expected a whole number ${MIN_SAMPLES}-${MAX_SAMPLES}.`);
    }
    samples = opts.flag;
    source = "flag";
  } else if (opts.env !== undefined && opts.env.trim() !== "") {
    const n = Number(opts.env.trim());
    if (!Number.isInteger(n) || n < MIN_SAMPLES || n > MAX_SAMPLES) {
      throw new Error(`AUDIT_SAMPLES "${opts.env}": expected a whole number ${MIN_SAMPLES}-${MAX_SAMPLES}.`);
    }
    samples = n;
    source = "env";
  } else if (opts.config?.samples !== undefined) {
    samples = clampSamples(opts.config.samples);
    source = "config";
  } else {
    samples = PROFILES[profile].scoredSamples;
    source = "profile";
  }
  const tiebreak = samples === 2 ? (opts.config?.tiebreak ?? true) : false;
  return { samples, tiebreak, source };
}

/** How many draws a SINGLE question gets, given the run-level resolution: an
 *  explicit per-question override (q.samples) always wins; otherwise a
 *  SCORED question gets the resolved run-level count and everything else
 *  stays single-sample — generalizes sampleCount(qtype, profile)'s rule from
 *  a fixed profile default to a resolved run-level count plus an override. */
export function sampleCountFor(q: Question, resolvedSamples: number): number {
  if (q.samples !== undefined) return clampSamples(q.samples);
  return isScored(q.qtype) ? resolvedSamples : 1;
}

/** WORST-CASE draws for one (engine, question) under a resolved run-level
 *  sampling, for the call-cap guard — generalizes maxDraws(qtype, profile)
 *  the same way sampleCountFor generalizes sampleCount. */
export function maxDrawsFor(q: Question, resolved: ResolvedSampling): number {
  const n = sampleCountFor(q, resolved.samples);
  return n === 2 && resolved.tiebreak ? n + 1 : n;
}

/** Stamp the EFFECTIVE per-question sample count onto every question the
 *  moment a brand's question set is first frozen: an explicit --questions row
 *  override is left exactly as authored; every other question is stamped
 *  with today's resolved run-level count. Once frozen, sampleCountFor always
 *  finds q.samples already set, so a LATER verify reuses these exact counts
 *  — never a freshly re-resolved default (mirrors how question text/qtype are
 *  already frozen forever). Pure; called once, in the "questions" step. */
export function freezeSamples(questions: Question[], resolvedSamples: number): Question[] {
  return questions.map((q) => ({ ...q, samples: sampleCountFor(q, resolvedSamples) }));
}

// ---------------------------------------------------------------------------
// Stage skips. Same precedence FAMILY as
// resolveSampling above: `--skip` flag > `AUDIT_SKIP` env > saylent.config
// `skip` > (none). Unlike sampling, there is no per-field merge across
// layers: whichever layer wins supplies the WHOLE set, exactly like
// resolveSampling's `samples` — a partial flag never "adds to" a config
// default, it replaces it.
// ---------------------------------------------------------------------------

export const SKIP_KEYS = ["drafts", "corpus", "gates"] as const;
export type SkipSource = "flag" | "env" | "config" | "none";

export interface ResolvedSkip extends Required<SkipStages> {
  /** which layer supplied the set, for an honest preflight line */
  source: SkipSource;
}

/** Parse a comma-separated `--skip`/`AUDIT_SKIP` value ("drafts,corpus,gates")
 *  into SkipStages. Throws a copy-pasteable error on an unrecognized stage
 *  name — never silently ignores a typo. */
export function parseSkipList(raw: string): SkipStages {
  const out: SkipStages = {};
  for (const tok of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!(SKIP_KEYS as readonly string[]).includes(tok)) {
      throw new Error(`--skip ${tok}: expected one of ${SKIP_KEYS.join(", ")}.`);
    }
    out[tok as (typeof SKIP_KEYS)[number]] = true;
  }
  return out;
}

/** Run-level skip resolution: `--skip` flag > `AUDIT_SKIP` env > saylent.config
 *  `skip` > none. The flag/env forms are raw comma strings; config is already
 *  the parsed object. Throws on a malformed flag/env value (mirrors
 *  resolveSampling's validation contract) — a bad override must stop the CLI,
 *  never fall back to "run everything" silently. */
export function resolveSkip(
  opts: { flag?: string; env?: string; config?: SkipStages | null } = {},
): ResolvedSkip {
  let stages: SkipStages;
  let source: SkipSource;
  if (opts.flag !== undefined && opts.flag.trim() !== "") {
    stages = parseSkipList(opts.flag);
    source = "flag";
  } else if (opts.env !== undefined && opts.env.trim() !== "") {
    stages = parseSkipList(opts.env);
    source = "env";
  } else if (opts.config && (opts.config.drafts || opts.config.corpus || opts.config.gates)) {
    stages = opts.config;
    source = "config";
  } else {
    stages = {};
    source = "none";
  }
  return { drafts: !!stages.drafts, corpus: !!stages.corpus, gates: !!stages.gates, source };
}

/** true when at least one stage is skipped — the CLI/preflight/bundle all
 *  gate their "skip" notices on this rather than repeating the OR. */
export function hasAnySkip(s: SkipStages | ResolvedSkip | null | undefined): boolean {
  return !!(s && (s.drafts || s.corpus || s.gates));
}
