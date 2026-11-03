// Per-answer cost explorer (answers.usage): pure, client-safe cost math for ONE
// stored answer. Every price comes from rates.ts, the single rate table the
// engine bills a run with (run-audit.ts), so the report's cost drawer, the CLI's
// live progress line and the run total can never disagree.
import {
  type CostEngine,
  DEFAULT_ANSWER_MODEL,
  MODEL_RATES,
  SEARCH_CENTS,
  SURFACE_REQUESTS,
  TYPICAL_ANSWER_USAGE,
  callCents,
  rateFor,
  surfaceRequestCents,
} from "./rates";
import { SURFACE_IDS, isSurfaceId } from "./surfaces";
import type { Engine } from "./types";

export type { CostEngine } from "./rates";

/** exact provider usage as stored in answers.usage (migration 0011). */
export interface AnswerUsage {
  input_tokens?: number;
  output_tokens?: number;
  searches?: number;
}

const ENGINES: CostEngine[] = ["chatgpt", "claude", "gemini", "perplexity"];

/** Each engine's rate at its DEFAULT answer model, plus its search fee. */
export const RATES: Readonly<Record<CostEngine, { inPerM: number; outPerM: number; searchCents: number }>> =
  Object.fromEntries(
    ENGINES.map((e) => [e, { ...MODEL_RATES[DEFAULT_ANSWER_MODEL[e]], searchCents: SEARCH_CENTS[e] }]),
  ) as Record<CostEngine, { inPerM: number; outPerM: number; searchCents: number }>;

/** Fallback cents per answer when usage is missing: a typical answer
 *  (rates.ts TYPICAL_ANSWER_USAGE) at the engine's default rate, or a surface's
 *  typical provider requests (rates.ts SURFACE_REQUESTS). Unrounded on
 *  purpose; display code formats it. Every estimator (the CLI preflight, the
 *  app's run-cost preview) prices a draw from this one map. */
export const COST_CENTS: Readonly<Record<Engine, number>> = Object.fromEntries([
  ...ENGINES.map((e) => [e, callCents(RATES[e], TYPICAL_ANSWER_USAGE[e], RATES[e].searchCents)]),
  ...SURFACE_IDS.map((s) => [s, surfaceRequestCents(SURFACE_REQUESTS[s].typical)]),
]) as Record<Engine, number>;

/** true when the row carries real token usage — the only case where we quote a
 * measured per-answer cost. Null usage (pre-0011 runs) or a usage blob with no
 * tokens is NOT measured; the UI shows an honest "not recorded" instead. */
export function hasRecordedUsage(usage: AnswerUsage | null | undefined): usage is AnswerUsage {
  return !!usage && (!!usage.input_tokens || !!usage.output_tokens);
}

/** Cents for ONE answer: !ok => 0 (failed calls aren't billed into the run
 * total); measured tokens => rate math at `model`'s rate when the table knows
 * it (the model the run actually used), else the engine's default rate;
 * otherwise the flat COST_CENTS fallback. */
export function answerCents(
  a: {
    engine: string;
    ok: boolean;
    usage?: AnswerUsage | null;
  },
  model?: string,
): number {
  // Surfaces bill per provider request, recorded as usage.searches. A "not
  // shown" answer (no AI Overview for the query) is still a successful,
  // billed search, so it is priced from its usage even though ok is false.
  if (isSurfaceId(a.engine)) {
    const requests = a.usage?.searches;
    if (typeof requests === "number") return surfaceRequestCents(requests);
    return a.ok ? COST_CENTS[a.engine] : 0;
  }
  const engine = a.engine as CostEngine;
  const base = RATES[engine];
  const fallback = COST_CENTS[engine];
  if (base === undefined || fallback === undefined) return 0; // unknown engine — never invent a price
  if (!a.ok) return 0;
  const u = a.usage;
  if (!hasRecordedUsage(u)) return fallback;
  const rate = rateFor(model) ?? base;
  return callCents(
    rate,
    { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0, searches: u.searches },
    base.searchCents,
  );
}

/** "$0.08" / "< $0.01" / "$0.00" — honest dollar rendering of a cents amount. */
export function formatCents(cents: number): string {
  if (cents > 0 && cents < 1) return "< $0.01";
  return `$${(cents / 100).toFixed(2)}`;
}
