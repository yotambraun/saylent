// the spec (see METHODOLOGY.md) — one file per engine, one shared contract.
// Answer SURFACES (surfaces.ts) share the same contract: their Ask routes to
// the operator's SERP-data provider (adapters/serp.ts), so ADAPTERS covers
// every id an answer can come from.
import { DEFAULT_SERP_PROVIDER, SURFACES } from "../surfaces";
import type { Engine, SurfaceId } from "../types";
import type { Ask } from "./shared";
import { keyMissing } from "./shared";
import { askChatgpt } from "./chatgpt";
import { askClaude } from "./claude";
import { askGemini } from "./gemini";
import { askPerplexity } from "./perplexity";
import type { SerpProvider } from "./serp";
import { serpApiProvider } from "./serpapi";

export type { AdapterConfig, Ask, AskResult } from "./shared";
export type { SerpProvider, SerpFetchContext } from "./serp";
export { isNotShown } from "./serp";

/** Every SERP-data provider implementation, keyed like surfaces.ts SERP_PROVIDERS. */
export const SERP_PROVIDER_IMPLS: Record<string, SerpProvider> = {
  serpapi: serpApiProvider,
};

/** The Ask for one answer surface: the configured provider's fetch, with the
 *  same missing-key contract every engine adapter has. */
export function surfaceAsk(surface: SurfaceId): Ask {
  return async (question, cfg) => {
    if (!cfg.apiKey) return keyMissing();
    const provider = SERP_PROVIDER_IMPLS[cfg.serpProvider ?? DEFAULT_SERP_PROVIDER];
    if (!provider || !provider.serves.includes(surface)) {
      return {
        ok: false,
        text: "",
        citations: [],
        error: `unknown: ${cfg.serpProvider ?? DEFAULT_SERP_PROVIDER} does not serve ${SURFACES[surface].label}`,
      };
    }
    return provider.fetch(surface, question, {
      apiKey: cfg.apiKey,
      locale: cfg.locale,
      fetchImpl: cfg.fetchImpl,
    });
  };
}

export const ADAPTERS: Record<Engine, Ask> = {
  chatgpt: askChatgpt,
  claude: askClaude,
  gemini: askGemini,
  perplexity: askPerplexity,
  google_ai_overview: surfaceAsk("google_ai_overview"),
  google_ai_mode: surfaceAsk("google_ai_mode"),
  copilot: surfaceAsk("copilot"),
};

/** The four model-API engines (the default set). Surfaces: surfaces.ts SURFACE_IDS. */
export const ENGINES: Engine[] = ["chatgpt", "claude", "gemini", "perplexity"];
