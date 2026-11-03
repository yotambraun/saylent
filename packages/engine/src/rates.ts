// THE price table (METHODOLOGY.md (model registry)): what one million tokens
// costs per model id, what a search costs per engine, and the per-call usage the
// estimates multiply them by. Pure and client-safe (no env, no SDK, no network),
// so the engine's run cost, the CLI preflight, the app's run-cost preview and the
// report's per-answer cost drawer all read the same numbers. answer-cost.ts and
// run-audit.ts derive their maps from here; nothing else holds a price.
//
// Units: CENTS per million tokens, cents per search.
//
// VERIFIED 2026-11-02 on the providers' official pages:
//   OpenAI     https://developers.openai.com/api/docs/pricing
//              https://developers.openai.com/api/docs/models/gpt-6-luna
//              web_search: $10 per 1,000 calls, search content billed as input tokens
//   Anthropic  https://platform.claude.com/docs/en/about-claude/pricing
//              web search: $10 per 1,000 searches, plus standard token costs
//   Google     https://ai.google.dev/gemini-api/docs/pricing
//   Perplexity https://docs.perplexity.ai (Sonar chat completions: see the note below)
//   SerpApi    https://serpapi.com/pricing (answer SURFACES: see SERP_REQUEST_CENTS)
//
// To refresh: change the numbers here, run `npx tsx scripts/cost-figures.ts`,
// and paste the sentences it prints into preflight.ts (the tests fail until the
// quoted figures match what the code computes).

import { DEFAULT_MODELS } from "./model-defaults";
import type { SerpProviderId } from "./surfaces";
import type { SurfaceId } from "./types";

/** The engines billed by the token (the four model APIs). Answer surfaces are
 *  billed per provider request instead: SERP_REQUEST_CENTS below. */
export type CostEngine = "chatgpt" | "claude" | "gemini" | "perplexity";

export interface TokenRate {
  /** cents per million input tokens */
  inPerM: number;
  /** cents per million output tokens (reasoning/thinking tokens bill as output) */
  outPerM: number;
}

/** Per-model token prices. Previous defaults stay listed so a run that used them
 *  (or a MODEL_* override that still points at them) is priced correctly. */
export const MODEL_RATES: Readonly<Record<string, TokenRate>> = {
  // OpenAI
  "gpt-6.1-sol": { inPerM: 200, outPerM: 1000 },
  "gpt-6-luna": { inPerM: 10, outPerM: 50 },
  "gpt-5.4": { inPerM: 250, outPerM: 1500 }, // <272K context; previous chatgpt default
  "gpt-5-mini": { inPerM: 25, outPerM: 200 }, // previous judge default; shuts down 2026-12-11
  // Anthropic
  "claude-sonnet-5-5": { inPerM: 200, outPerM: 1000 },
  "claude-haiku-5-5": { inPerM: 10, outPerM: 50 }, // prompts up to 100K tokens
  "claude-sonnet-4-6": { inPerM: 300, outPerM: 1500 },
  "claude-haiku-4-5": { inPerM: 100, outPerM: 500 },
  // Google. List price from 2027-01-01; Google bills $0.75 / $3.75 through
  // 2026-12-31, so estimates made before then run high, never low.
  "gemini-3.6-flash": { inPerM: 150, outPerM: 750 },
  // Perplexity. Sonar Chat Completions support ended 2026-09-27; synchronous
  // requests keep working by being reformulated as Agent API requests, and the
  // pricing page no longer states the Sonar request fee. These are the last
  // published Sonar rates (checked 2026-07-03), kept until a live run measures
  // what the reformulated requests bill.
  sonar: { inPerM: 100, outPerM: 100 },
};

/** Cents per search (or per request, for Perplexity's request fee) by engine.
 *  Gemini 3 grounding is free for the first 5,000 search queries a month across
 *  a project, then $14 per 1,000; a CLI audit stays well inside the free tier,
 *  so it is priced at 0 here. */
export const SEARCH_CENTS: Readonly<Record<CostEngine, number>> = {
  chatgpt: 1,
  claude: 1,
  gemini: 0,
  perplexity: 1,
};

/** The default answer model per engine (from model-defaults.ts). */
export const DEFAULT_ANSWER_MODEL: Readonly<Record<CostEngine, string>> = {
  chatgpt: DEFAULT_MODELS.chatgptAnswer,
  claude: DEFAULT_MODELS.claudeAnswer,
  gemini: DEFAULT_MODELS.geminiAnswer,
  perplexity: DEFAULT_MODELS.perplexityAnswer,
};

export interface CallUsage {
  input_tokens: number;
  output_tokens: number;
  searches?: number;
}

/** A typical answer per engine: the MEDIAN usage of the answers in the bundled
 *  sample run (examples/kestrel/run.json, smoke, 2026-09-10, the July defaults).
 *  Used only where a stored answer has no usage of its own, and by estimates.
 *  scripts/cost-figures.ts recomputes it from the file; a test pins the two. */
export const TYPICAL_ANSWER_USAGE: Readonly<Record<CostEngine, CallUsage>> = {
  chatgpt: { input_tokens: 17158, output_tokens: 1574.5, searches: 3 },
  claude: { input_tokens: 10726, output_tokens: 1012, searches: 1 },
  gemini: { input_tokens: 477, output_tokens: 1495.5, searches: 2 },
  perplexity: { input_tokens: 20, output_tokens: 419, searches: 1 },
};

export type CostRole = "judge" | "drafter" | "brand";

/** One call of each judgment role, measured offline by scripts/cost-figures.ts
 *  from the prompts the engine itself builds (judge: the sample run's answers,
 *  median; drafter: the sample run's fixes, median; brand: the prompt at its
 *  16,000-character website-text cap), at about 4 characters per token, with the
 *  reply at the role's max_tokens budget. A test re-measures and pins these. */
export const ROLE_CALL_USAGE: Readonly<Record<CostRole, CallUsage>> = {
  judge: { input_tokens: 2072, output_tokens: 1200 },
  drafter: { input_tokens: 567, output_tokens: 2200 },
  brand: { input_tokens: 4106, output_tokens: 1000 },
};

/** The default model of each judgment role (the Anthropic slot; the OpenAI
 *  defaults are priced the same or lower, so this is the higher estimate). */
export const DEFAULT_ROLE_MODEL: Readonly<Record<CostRole, string>> = {
  judge: DEFAULT_MODELS.judgeAnthropic,
  drafter: DEFAULT_MODELS.drafter,
  brand: DEFAULT_MODELS.brand,
};

/** Cents for one call at a rate. */
export function callCents(rate: TokenRate, usage: CallUsage, searchCents = 0): number {
  return (
    (usage.input_tokens * rate.inPerM) / 1_000_000 +
    (usage.output_tokens * rate.outPerM) / 1_000_000 +
    (usage.searches ?? 0) * searchCents
  );
}

/** The rate for a model id, or undefined for an id this table does not know. */
export function rateFor(model: string | undefined): TokenRate | undefined {
  return model ? MODEL_RATES[model.trim()] : undefined;
}

/** Cents for one call of a judgment role on `model` (default: the role's default
 *  model). An unknown model is priced at the default model's rate, never at 0. */
export function roleCallCents(role: CostRole, model?: string): number {
  const rate = rateFor(model) ?? MODEL_RATES[DEFAULT_ROLE_MODEL[role]];
  return callCents(rate, ROLE_CALL_USAGE[role]);
}

/** Per-call cents of each role at its default model: what the CLI preflight and
 *  the app's run-cost preview quote. Unrounded; display code formats it. */
export const ROLE_COST_CENTS: Readonly<Record<CostRole, number>> = {
  judge: roleCallCents("judge"),
  drafter: roleCallCents("drafter"),
  brand: roleCallCents("brand"),
};

// ---------------------------------------------------------------------------
// Answer SURFACES (surfaces.ts): billed per request to the operator's own
// SERP-data provider, not per token. No tokens are involved in fetching them;
// the judge call that reads the answer is billed like any other judge call.
// ---------------------------------------------------------------------------

/** Cents per successful provider request. SerpApi sells monthly plans, so a
 *  search costs the plan price divided by its searches: Starter $25 / 1,000 =
 *  2.5 cents, Developer $75 / 5,000 = 1.5, Production $150 / 15,000 = 1.0
 *  (https://serpapi.com/pricing, checked 2026-11-02; the free plan has 250 a
 *  month). Priced at the Starter rate, the highest per-search price of any paid
 *  plan, so an estimate runs high, never low. Cached and failed searches are not
 *  counted by SerpApi; "Ludicrous Speed" plans bill 2x, which this ignores. */
export const SERP_REQUEST_CENTS: Readonly<Record<SerpProviderId, number>> = {
  serpapi: 2.5,
};

/** Provider requests per answer. AI Overviews: Google either inlines the
 *  overview in the first results page (1 request) or hands back a page_token
 *  that needs a second request to the google_ai_overview engine (2); SerpApi
 *  documents inline delivery for English searches in a few countries only, so
 *  the typical figure is the 2-request case. AI Mode and Copilot: 1. */
export const SURFACE_REQUESTS: Readonly<Record<SurfaceId, { low: number; typical: number }>> = {
  google_ai_overview: { low: 1, typical: 2 },
  google_ai_mode: { low: 1, typical: 1 },
  copilot: { low: 1, typical: 1 },
};

/** Cents for `requests` provider requests on `provider`. */
export function surfaceRequestCents(requests: number, provider: SerpProviderId = "serpapi"): number {
  return requests * SERP_REQUEST_CENTS[provider];
}
