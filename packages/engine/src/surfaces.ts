// Answer SURFACES: the one registry of every place an answer can come from.
//
// Two kinds, one contract:
//   model_api  the four model APIs saylent has always asked (chatgpt, claude,
//              gemini, perplexity). The answer is generated for us, on request.
//   serp       a surface buyers actually read inside a search results page
//              (Google AI Overviews, Google AI Mode, Microsoft Copilot). Nobody
//              offers an official API for these, so saylent reads them through a
//              BRING-YOUR-OWN SERP-data provider (SerpApi today). The provider is
//              a plug-in: SERP_PROVIDERS below lists what each one serves, and
//              adapters/serp.ts turns its response into the same
//              {text, citations, usage} an engine answer has.
//
// Every surface yields an AnswerRow identical in shape to an engine answer, so
// the judge, the score, the source intelligence and every report section reuse
// all of it. Adding a surface = one entry here + its id in types.ts SurfaceId +
// one provider mapping. Adding a provider = one SerpProvider (adapters/serp.ts)
// + one entry in SERP_PROVIDERS + its request price in rates.ts.
//
// PURE and client-safe: no SDK, no network, no env read. The app's run options
// form and engine picker import this file directly.
import type { Engine, ModelEngine, SurfaceId } from "./types";

/** The model APIs, in canonical order (mirrors engines.ts ALL_ENGINES). */
export const MODEL_ENGINE_IDS: readonly ModelEngine[] = ["chatgpt", "claude", "gemini", "perplexity"];

/** The SERP surfaces, in canonical order. Never asked unless selected. */
export const SURFACE_IDS: readonly SurfaceId[] = ["google_ai_overview", "google_ai_mode", "copilot"];

/** Every answer source, canonical order: model APIs first, then surfaces. */
export const ENGINE_IDS: readonly Engine[] = [...MODEL_ENGINE_IDS, ...SURFACE_IDS];

export function isSurfaceId(id: unknown): id is SurfaceId {
  return typeof id === "string" && (SURFACE_IDS as readonly string[]).includes(id);
}

export function isEngineId(id: unknown): id is Engine {
  return typeof id === "string" && (ENGINE_IDS as readonly string[]).includes(id);
}

// ---------------------------------------------------------------------------
// SERP-data providers (bring your own key)
// ---------------------------------------------------------------------------

export type SerpProviderId = "serpapi";

export interface SerpProviderMeta {
  id: SerpProviderId;
  label: string;
  /** the ONE env var the key is read from (CLI keys, the app's env/console) */
  envVar: string;
  /** where to get a key, for `saylent keys` and the docs */
  hint: string;
  docsUrl: string;
  /** which surfaces this provider can fetch, and the provider's own engine
   *  name for each (documented values, quoted from the provider's docs) */
  serves: Partial<Record<SurfaceId, string>>;
  /** one sentence on throughput limits, quoted from the provider's docs */
  rateLimit: string;
  /** the pricing page the per-request cents in rates.ts were read from */
  pricingUrl: string;
  /** when the pricing above was last checked */
  pricingChecked: string;
}

/** Verified 2026-11-02 against https://serpapi.com/google-ai-overview-api,
 *  https://serpapi.com/google-ai-mode-api, https://serpapi.com/ai-overview,
 *  https://serpapi.com/bing-copilot-api, https://serpapi.com/pricing and
 *  https://serpapi.com/api-status-and-error-codes. */
export const SERP_PROVIDERS: Readonly<Record<SerpProviderId, SerpProviderMeta>> = {
  serpapi: {
    id: "serpapi",
    label: "SerpApi",
    envVar: "SERPAPI_API_KEY",
    hint: "from serpapi.com/manage-api-key (the free plan has 250 searches a month)",
    docsUrl: "https://serpapi.com/google-ai-mode-api",
    serves: {
      google_ai_overview: "google + google_ai_overview",
      google_ai_mode: "google_ai_mode",
      copilot: "bing_copilot",
    },
    rateLimit:
      "Each plan has an hourly throughput cap (free 50/hour, Starter 200/hour, Developer 1,000/hour); " +
      "over it, or out of monthly searches, SerpApi answers HTTP 429. Cached and failed searches are not counted.",
    pricingUrl: "https://serpapi.com/pricing",
    pricingChecked: "2026-11-02",
  },
};

export const DEFAULT_SERP_PROVIDER: SerpProviderId = "serpapi";

// ---------------------------------------------------------------------------
// the registry
// ---------------------------------------------------------------------------

export interface SurfaceCapabilities {
  /** the surface returns the answer's text (always true today) */
  answerText: boolean;
  /** the surface returns the pages the answer cites */
  citations: boolean;
  /** citations arrive in the order the answer uses them (position is real) */
  citationOrder: boolean;
  /** which locale knobs the fetch honors */
  locale: { country: boolean; language: boolean; location: boolean };
  /** the surface may legitimately show NO answer for a question (Google shows
   *  an AI Overview for some queries only). Recorded as a "not shown" gap,
   *  never as an absence verdict. */
  mayNotAnswer: boolean;
}

export interface SurfaceDescriptor {
  id: Engine;
  /** display name, e.g. "Google AI Overviews" */
  label: string;
  kind: "model_api" | "serp";
  /** who generates the answer (for the report's provenance line) */
  vendor: string;
  /** one plain sentence for docs, help and pickers */
  description: string;
  /** model APIs: the provider key that asks it. SERP surfaces: none of their
   *  own; the key is the SERP provider's (SERP_PROVIDERS[...].envVar). */
  keyEnvVar: string | null;
  capabilities: SurfaceCapabilities;
  /** how a call is billed: tokens (rates.ts MODEL_RATES) or per provider
   *  request (rates.ts SERP_REQUEST_CENTS × SURFACE_REQUESTS) */
  cost: "tokens" | "per_request";
  /** "Asking ChatGPT" — the live stage label */
  stageLabel: string;
}

const MODEL_CAPS: SurfaceCapabilities = {
  answerText: true,
  citations: true,
  citationOrder: true,
  locale: { country: false, language: false, location: false },
  mayNotAnswer: false,
};

export const SURFACES: Readonly<Record<Engine, SurfaceDescriptor>> = {
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    kind: "model_api",
    vendor: "OpenAI",
    description: "OpenAI Responses API with web search, the model behind ChatGPT search.",
    keyEnvVar: "OPENAI_API_KEY",
    capabilities: MODEL_CAPS,
    cost: "tokens",
    stageLabel: "Asking ChatGPT",
  },
  claude: {
    id: "claude",
    label: "Claude",
    kind: "model_api",
    vendor: "Anthropic",
    description: "Anthropic Messages API with web search.",
    keyEnvVar: "ANTHROPIC_API_KEY",
    capabilities: MODEL_CAPS,
    cost: "tokens",
    stageLabel: "Asking Claude",
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    kind: "model_api",
    vendor: "Google",
    description: "Gemini API grounded with Google Search.",
    keyEnvVar: "GEMINI_API_KEY",
    capabilities: MODEL_CAPS,
    cost: "tokens",
    stageLabel: "Asking Gemini",
  },
  perplexity: {
    id: "perplexity",
    label: "Perplexity",
    kind: "model_api",
    vendor: "Perplexity",
    description: "Perplexity Sonar, an answer engine with built-in search.",
    keyEnvVar: "PERPLEXITY_API_KEY",
    capabilities: MODEL_CAPS,
    cost: "tokens",
    stageLabel: "Asking Perplexity",
  },
  google_ai_overview: {
    id: "google_ai_overview",
    label: "Google AI Overviews",
    kind: "serp",
    vendor: "Google",
    description:
      "The AI Overview at the top of a Google results page, read through your SERP-data provider. " +
      "Google shows one for some queries only; a question without one is recorded as not shown.",
    keyEnvVar: null,
    capabilities: {
      answerText: true,
      citations: true,
      citationOrder: true,
      locale: { country: true, language: true, location: true },
      mayNotAnswer: true,
    },
    cost: "per_request",
    stageLabel: "Reading Google AI Overviews",
  },
  google_ai_mode: {
    id: "google_ai_mode",
    label: "Google AI Mode",
    kind: "serp",
    vendor: "Google",
    description: "Google's conversational AI Mode answer, read through your SERP-data provider.",
    keyEnvVar: null,
    capabilities: {
      answerText: true,
      citations: true,
      citationOrder: true,
      locale: { country: true, language: true, location: true },
      mayNotAnswer: true,
    },
    cost: "per_request",
    stageLabel: "Reading Google AI Mode",
  },
  copilot: {
    id: "copilot",
    label: "Microsoft Copilot",
    kind: "serp",
    vendor: "Microsoft",
    description:
      "The Copilot answer in Bing search, read through your SERP-data provider. The provider documents " +
      "no country or language parameter for it, so it answers from the provider's default location.",
    keyEnvVar: null,
    capabilities: {
      answerText: true,
      citations: true,
      citationOrder: true,
      locale: { country: false, language: false, location: false },
      mayNotAnswer: true,
    },
    cost: "per_request",
    stageLabel: "Reading Microsoft Copilot",
  },
};

/** "Google AI Overviews" for a known id; a capitalized fallback otherwise, so an
 *  id from a newer bundle still renders. */
export function engineLabel(id: string): string {
  const known = (SURFACES as Record<string, SurfaceDescriptor | undefined>)[id];
  if (known) return known.label;
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : id;
}

/** The env var that unlocks an answer source: the engine's own key, or the
 *  SERP provider's key for a surface. */
export function keyEnvVarFor(id: Engine, provider: SerpProviderId = DEFAULT_SERP_PROVIDER): string {
  return SURFACES[id].keyEnvVar ?? SERP_PROVIDERS[provider].envVar;
}

/** The provenance string a surface answer is stamped with in the run header's
 *  `models` map, e.g. "serpapi:google_ai_mode". Model APIs keep their model id. */
export function surfaceSourceId(id: SurfaceId, provider: SerpProviderId = DEFAULT_SERP_PROVIDER): string {
  return `${provider}:${id}`;
}

/** Where a surface answer is fetched from: country (two-letter, e.g. "us"),
 *  language (BCP47, e.g. "en" or "pt-BR") and an optional city-level location
 *  ("Austin, Texas, United States"). Every field optional; each provider maps
 *  the ones its surface honors (SurfaceCapabilities.locale) and ignores the rest. */
export interface SurfaceLocale {
  country?: string;
  language?: string;
  location?: string;
}

export const COUNTRY_PATTERN = /^[a-zA-Z]{2}$/;

/** Validate a locale from a flag/config/form. Returns the cleaned value or the
 *  sentence to show. Country is lowercased (the providers' `gl` convention). */
export function normalizeSurfaceLocale(
  input: { country?: unknown; language?: unknown; location?: unknown } | null | undefined,
): { ok: true; value: SurfaceLocale } | { ok: false; error: string } {
  const out: SurfaceLocale = {};
  const country = typeof input?.country === "string" ? input.country.trim() : "";
  if (country) {
    if (!COUNTRY_PATTERN.test(country)) {
      return { ok: false, error: `"${country}" is not a two-letter country code. Use something like us, gb or de.` };
    }
    out.country = country.toLowerCase();
  }
  const language = typeof input?.language === "string" ? input.language.trim() : "";
  if (language) {
    if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(language)) {
      return { ok: false, error: `"${language}" is not a language tag. Use something like en or pt-BR.` };
    }
    out.language = language;
  }
  const location = typeof input?.location === "string" ? input.location.replace(/\s+/g, " ").trim() : "";
  if (location) {
    if (location.length > 120) return { ok: false, error: "A location is capped at 120 characters." };
    out.location = location;
  }
  return { ok: true, value: out };
}

/** The error prefix of a surface answer that was legitimately not shown
 *  (adapters/serp.ts notShown): a coverage gap, never a failure, never an
 *  absence verdict. */
export const NOT_SHOWN_PREFIX = "no_answer:";

/** true for an answer row a surface did not show (client-safe twin of
 *  adapters/serp.ts isNotShown, for the report and the app). */
export function isNotShownRow(row: { ok: boolean; error?: string | null }): boolean {
  return !row.ok && typeof row.error === "string" && row.error.startsWith(NOT_SHOWN_PREFIX);
}
