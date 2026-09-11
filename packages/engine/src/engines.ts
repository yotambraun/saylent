// Pure resolution of a brand's per-brand answer-engine subset. No Next/Supabase
// imports (this package is PURE), so createBrand/updateBrand (server actions), the
// Inngest pipeline, and vitest all share ONE source of truth for the rules.
//
// RULES (methodology-sensitive):
//  * Only the four ANSWER engines are selectable. The judge/brand/drafter models
//    are never touched by any of this.
//  * Default is ALL FOUR ("we ask all four"). NULL / empty resolve to four.
//  * Any user may narrow the set, floored at ENGINE_FLOOR so the cross-family verdict
//    stays meaningful (one engine is not an audit).
//  * The set is FROZEN like the question set: the run honors the engines frozen in the
//    question_set envelope, and changing the selection re-baselines (see functions.ts +
//    settings/actions.ts). This module only computes the effective list — the freeze +
//    re-baseline live at the call sites.
import type { Engine } from "./types";

/** Canonical answer-engine order (mirrors adapters/index.ts ENGINES + the Engine union). */
export const ALL_ENGINES: readonly Engine[] = ["chatgpt", "claude", "gemini", "perplexity"];

/** Minimum engines a narrowed selection may keep. Two keeps at least a cross-family
 *  read alive (judge pairs: chatgpt+gemini→anthropic, claude+perplexity→openai); one
 *  engine would make the verdict a coin-flip and defeat the whole methodology. */
export const ENGINE_FLOOR = 2;

/** Sanitize a stored/persisted selection into the effective engine list the pipeline
 *  asks. NULL / empty / below-floor / all-four → all four (the default). Filters to valid
 *  engines in canonical order (dedupes + drops junk). This is the run-time + freeze-time
 *  resolver. */
export function resolveEngines(stored: readonly string[] | null | undefined): Engine[] {
  if (!stored || stored.length === 0) return [...ALL_ENGINES];
  const valid = ALL_ENGINES.filter((e) => stored.includes(e));
  return valid.length >= ENGINE_FLOOR ? valid : [...ALL_ENGINES];
}

/** The engine set FROZEN for a run: the envelope's engines if present (the audit that
 *  established the baseline froze them there), else resolve from the live column (a
 *  brand-new set being frozen now, or a legacy brand → all four). The run must ALWAYS use
 *  this, never the live column directly, so a verify reuses the baseline's exact set. */
export function frozenEngines(
  envelope: { engines?: readonly string[] | null } | null | undefined,
  liveColumn: readonly string[] | null | undefined,
): Engine[] {
  if (envelope?.engines && envelope.engines.length > 0) return resolveEngines(envelope.engines);
  return resolveEngines(liveColumn);
}

export type SelectionResult = { ok: true; store: string[] | null } | { ok: false; error: string };

/** Validate a raw selection from the UI into what to PERSIST on brands.engines.
 *  - empty / all four → null (the default; we store null, never the full array)
 *  - a subset below the floor → user-facing error (client enforces too, this is the
 *    server double-check)
 *  - otherwise → the validated subset in canonical order */
export function normalizeSelection(
  selection: readonly string[] | null | undefined,
): SelectionResult {
  if (!selection || selection.length === 0) return { ok: true, store: null };
  const valid = ALL_ENGINES.filter((e) => selection.includes(e));
  if (valid.length === 0) return { ok: true, store: null };
  if (valid.length < ENGINE_FLOOR) {
    return {
      ok: false,
      error: `Choose at least ${ENGINE_FLOOR} engines — a single engine can't cross-check the verdict.`,
    };
  }
  if (valid.length === ALL_ENGINES.length) return { ok: true, store: null }; // all four = default
  return { ok: true, store: valid };
}

/** True when two persisted selections resolve to DIFFERENT effective engine sets — the
 *  trigger to re-baseline (clear the frozen set + bump the version). Order-independent:
 *  resolveEngines canonicalizes both sides, so ["claude","chatgpt"] == ["chatgpt","claude"]
 *  and null == ["chatgpt","claude","gemini","perplexity"] (both = all four). */
export function engineSetChanged(
  current: readonly string[] | null | undefined,
  next: readonly string[] | null | undefined,
): boolean {
  return JSON.stringify(resolveEngines(current)) !== JSON.stringify(resolveEngines(next));
}
