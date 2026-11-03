// the spec (see METHODOLOGY.md) — one shared contract for all four adapters.
// Every adapter: try/catch around everything; ~900 token cap; citations deduped
// by normUrl; missing key ⇒ {ok:false, error:"missing_key: KEY missing"}
// (engine renders as flagged, run continues). Model names always arrive from
// the registry.
//
// Provider errors look like our bug. Adapters
// classify the caught error into a small AdapterErrorKind (below) and stamp it
// as a "<kind>: <message>" prefix on AskResult.error — the ONLY channel that
// survives all the way to packages/cli/src/errors.ts's per-provider plain-
// sentence map (AnswerRow.error is a plain string; see observe.ts, which
// copies AskResult.error verbatim). Retries (429/5xx, bounded, jittered) live
// here too so every adapter gets the same backoff without duplicating it.
import { decodeEntities } from "../entities";
import type { SerpProviderId, SurfaceLocale } from "../surfaces";
import type { Citation } from "../types";
import { normUrl } from "../util";

export interface AskUsage {
  input_tokens?: number;
  output_tokens?: number;
  searches?: number;
}

export interface AskResult {
  ok: boolean;
  text: string;
  citations: Citation[];
  error?: string;
  /** exact provider-reported usage — persisted per answer for true cost accounting */
  usage?: AskUsage;
  /** the web searches the engine ran, as its response reports them
   *  (search-queries.ts); absent when the engine's API does not report them */
  search_queries?: string[];
}

export interface AdapterConfig {
  /** the answer model id; for an answer surface, its provenance id
   *  (surfaces.ts surfaceSourceId, e.g. "serpapi:google_ai_mode") */
  model: string;
  apiKey?: string;
  /** engine-specific search cap override (smoke cost lever) */
  maxSearches?: number;
  /** answer surfaces only: where the answer is fetched from (gl/hl/location) */
  locale?: SurfaceLocale;
  /** answer surfaces only: which SERP-data provider serves it (default serpapi) */
  serpProvider?: SerpProviderId;
  /** answer surfaces only: injectable fetch (recorded fixtures in tests) */
  fetchImpl?: typeof fetch;
}

export type Ask = (question: string, cfg: AdapterConfig) => Promise<AskResult>;

export const MAX_OUTPUT_TOKENS = 900;

export function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of citations) {
    if (!c.url) continue;
    const key = normUrl(c.url);
    if (seen.has(key)) continue;
    seen.add(key);
    // Citation titles come off an HTML page too, so they carry (sometimes
    // doubly-escaped) entities — normalize once, at the one place every
    // adapter's citations pass through.
    const title = c.title ? decodeEntities(c.title) : "";
    out.push({ url: c.url, ...(title ? { title } : {}) });
  }
  return out;
}

export const keyMissing = (): AskResult => ({
  ok: false,
  text: "",
  citations: [],
  error: "missing_key: KEY missing",
});

// Error classification and secret redaction live in errors.ts (no heavy
// imports, so llm.ts can share them without pulling in the crawler); re-exported
// here, where every adapter has always imported them from.
export {
  type AdapterErrorKind,
  type ClassifiedError,
  SECRET_SHAPES,
  classifyAdapterError,
  redactSecretsInText,
} from "./errors";
import { classifyAdapterError, redactSecretsInText } from "./errors";

export const failed = (e: unknown): AskResult => {
  const c = classifyAdapterError(e);
  return {
    ok: false,
    text: "",
    citations: [],
    // Redact BEFORE truncation, so a half-cut key can never survive.
    error: redactSecretsInText(`${c.kind}: ${c.message}`).slice(0, 500),
  };
};

// ---------------------------------------------------------------------------
// F2 — bounded retry with backoff for 429/5xx (respects the call cap: retries
// stay INSIDE this one Ask() invocation, so whatever counts calls upstream —
// the search/call-cap accounting in run-audit.ts — never sees extra calls).
// ---------------------------------------------------------------------------

export interface RetryOptions {
  /** additional attempts after the first (default 2, so up to 3 total tries) */
  retries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retries `fn` on a rate-limit or server-side classification, with
 *  exponential backoff + full jitter. Any other classification (auth, quota,
 *  not_found, unknown) rethrows immediately — those never succeed on retry. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 2, baseDelayMs = 300, sleep = defaultSleep } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const { kind } = classifyAdapterError(e);
      const retryable = kind === "rate_limit" || kind === "server";
      if (!retryable || attempt >= retries) throw e;
      const delay = baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs;
      await sleep(delay);
    }
  }
}
