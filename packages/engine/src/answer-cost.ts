// Per-answer cost explorer (answers.usage) — pure, client-safe cost
// math for ONE stored answer, reusing the SAME per-model pricing the engine bills
// the run with. RATES + COST_CENTS + the per-answer formula are lifted verbatim
// from src/inngest/functions.ts (see METHODOLOGY.md); numbers MUST stay identical there and here. That module
// imports the Inngest client + service-role admin, so it can't be pulled into a
// client component — hence this pure copy. DOCS NOTE (below) flags the follow-up
// to make functions.ts import THIS module so there's one source of truth.

export type CostEngine = "chatgpt" | "claude" | "gemini" | "perplexity";

/** exact provider usage as stored in answers.usage (migration 0011). */
export interface AnswerUsage {
  input_tokens?: number;
  output_tokens?: number;
  searches?: number;
}

// the spec (see METHODOLOGY.md) cost map — fallback estimates (cents/answer) when usage is missing.
export const COST_CENTS: Record<CostEngine, number> = {
  chatgpt: 3,
  claude: 4,
  gemini: 1.3, // billed 2026-07-21 (gemini-3.6-flash; thinking bills as output) — keep identical to functions.ts
  perplexity: 1.5,
};

// real provider rates (verified 2026-07-03; per MILLION tokens + cents per search).
export const RATES: Record<CostEngine, { inPerM: number; outPerM: number; searchCents: number }> = {
  chatgpt: { inPerM: 125, outPerM: 1000, searchCents: 1 }, // gpt-5-class, $10/1K searches
  claude: { inPerM: 300, outPerM: 1500, searchCents: 1 }, // sonnet-4-6, $10/1K searches
  gemini: { inPerM: 150, outPerM: 750, searchCents: 0 }, // sourced ai.google.dev/gemini-api/docs/pricing 2026-07-21; search free <5k prompts/mo
  perplexity: { inPerM: 100, outPerM: 100, searchCents: 1 }, // sonar + request fee
};

/** true when the row carries real token usage — the only case where we quote a
 * measured per-answer cost. Null usage (pre-0011 runs) or a usage blob with no
 * tokens is NOT measured; the UI shows an honest "not recorded" instead. */
export function hasRecordedUsage(usage: AnswerUsage | null | undefined): usage is AnswerUsage {
  return !!usage && (!!usage.input_tokens || !!usage.output_tokens);
}

/** Cents for ONE answer — mirrors answerCents() in src/inngest/functions.ts
 * exactly: !ok ⇒ 0 (failed calls aren't billed into the run total); measured
 * tokens ⇒ rate math; otherwise the flat COST_CENTS fallback. */
export function answerCents(a: {
  engine: string;
  ok: boolean;
  usage?: AnswerUsage | null;
}): number {
  const engine = a.engine as CostEngine;
  const r = RATES[engine];
  const fallback = COST_CENTS[engine];
  if (r === undefined || fallback === undefined) return 0; // unknown engine — never invent a price
  if (!a.ok) return 0;
  const u = a.usage;
  if (!hasRecordedUsage(u)) return fallback;
  return (
    ((u.input_tokens ?? 0) * r.inPerM) / 1_000_000 +
    ((u.output_tokens ?? 0) * r.outPerM) / 1_000_000 +
    (u.searches ?? 0) * r.searchCents
  );
}

/** "$0.08" / "< $0.01" / "$0.00" — honest dollar rendering of a cents amount. */
export function formatCents(cents: number): string {
  if (cents > 0 && cents < 1) return "< $0.01";
  return `$${(cents / 100).toFixed(2)}`;
}
