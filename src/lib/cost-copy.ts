// ONE cost truth. Every surface that prints a price in prose — README.public.md,
// packages/cli/README.md, the docs (costs, quickstart, mcp, environment, index,
// integrations), .env.example, the landing page and the CLI preflight — quotes
// the two ranges below and nothing else.
//
// WHERE THE NUMBERS COME FROM: estimateRunCost() in question-options.ts, the
// same estimator the app shows above the "Run audit" button, run over the
// shipped 23-question template set (engine questions.ts generateQuestions for a
// brand with two competitors) across all four engines — full profile at 2
// samples, smoke profile at 1. The published range is that computed range
// rounded OUTWARD to the nearest $0.10 and then widened to cover the runs we
// actually recorded, so no reader can find a real number outside a printed one.
// question-options.test.ts recomputes both from the estimator and fails if this
// file (or packages/cli/src/preflight.ts, which carries the same two sentences
// for the published CLI) ever drifts from it — so a provider rate change breaks
// the build instead of quietly making the docs wrong.
//
// PURE by contract, like question-options.ts: no Next, no Supabase, no node
// builtins.

export interface UsdRange {
  lowUsd: number;
  highUsd: number;
}

/** What our own published smoke runs cost (docs/EXPERIMENTS.md, both across all
 *  four engines). The published smoke range must contain both. */
export const RECORDED_SMOKE_RUNS_USD = [0.93, 1.11] as const;

/** The estimator's output for the shipped 23-question set across four engines,
 *  full profile, 2 samples. Pinned by question-options.test.ts. */
export const FULL_COMPUTED_USD: UsdRange = { lowUsd: 3.73, highUsd: 5.5 };

/** The same set on the smoke profile (6 of the 23 asked), 1 sample. */
export const SMOKE_COMPUTED_USD: UsdRange = { lowUsd: 0.66, highUsd: 0.75 };

const floorDime = (n: number): number => Math.floor(n * 10 + 1e-9) / 10;
const ceilDime = (n: number): number => Math.ceil(n * 10 - 1e-9) / 10;

/** The range we print: `computed` rounded outward to the nearest $0.10, widened
 *  to cover every figure in `alsoCover` (the runs we recorded). Outward, never
 *  nearest, so the printed range can never exclude a number the product itself
 *  produces. */
export function publishedRange(computed: UsdRange, alsoCover: readonly number[] = []): UsdRange {
  return {
    lowUsd: floorDime(Math.min(computed.lowUsd, ...alsoCover)),
    highUsd: ceilDime(Math.max(computed.highUsd, ...alsoCover)),
  };
}

/** $3.70-$5.50: 23 questions, four engines, 2 samples. */
export const FULL_RANGE_USD: UsdRange = publishedRange(FULL_COMPUTED_USD);
/** $0.60-$1.20: 6 questions, four engines, 1 sample, widened to the two
 *  recorded runs ($0.93 and $1.11). */
export const SMOKE_RANGE_USD: UsdRange = publishedRange(SMOKE_COMPUTED_USD, RECORDED_SMOKE_RUNS_USD);

/** "$0.60 to $1.20" — the form the prose uses. */
export function formatRange(range: UsdRange): string {
  return `$${range.lowUsd.toFixed(2)} to $${range.highUsd.toFixed(2)}`;
}

export const FULL_RANGE_TEXT = formatRange(FULL_RANGE_USD);
export const SMOKE_RANGE_TEXT = formatRange(SMOKE_RANGE_USD);

/** The smoke sentence, byte-identical to packages/cli/src/preflight.ts's copy
 *  (the published CLI cannot import from src/). */
export const SMOKE_COST_SENTENCE = `about ${SMOKE_RANGE_TEXT} with four engines; our recorded runs cost $0.93 and $1.11`;

/** The same for `full`. */
export const FULL_COST_SENTENCE = `about ${FULL_RANGE_TEXT} with four engines`;
