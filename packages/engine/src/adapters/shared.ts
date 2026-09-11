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
}

export interface AdapterConfig {
  model: string;
  apiKey?: string;
  /** engine-specific search cap override (smoke cost lever) */
  maxSearches?: number;
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

// ---------------------------------------------------------------------------
// Provider error classification
// ---------------------------------------------------------------------------

/** The small taxonomy every provider's error collapses into, regardless of
 *  SDK shape (OpenAI/Anthropic SDK errors carry `.status`/`.code`; the
 *  hand-rolled Perplexity fetch tags a plain Error with `.status`; a network
 *  timeout has neither). packages/cli/src/errors.ts owns the one-sentence
 *  copy per (provider, kind) — this module only decides WHICH kind. */
export type AdapterErrorKind =
  | "missing_key"
  | "auth"
  | "quota"
  | "rate_limit"
  | "not_found"
  | "server"
  | "unknown";

export interface ClassifiedError {
  kind: AdapterErrorKind;
  status?: number;
  message: string;
}

function extractStatus(e: unknown): number | undefined {
  const anyE = e as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
  } | null;
  const direct = anyE?.status ?? anyE?.statusCode ?? anyE?.response?.status;
  if (typeof direct === "number") return direct;
  const msg = e instanceof Error ? e.message : String(e);
  const m = /\b([45]\d{2})\b/.exec(msg);
  return m ? Number(m[1]) : undefined;
}

function extractCode(e: unknown): string {
  const anyE = e as {
    code?: unknown;
    error?: { code?: unknown; type?: unknown; error?: { type?: unknown } };
    name?: unknown;
  } | null;
  const candidates = [
    anyE?.code,
    anyE?.error?.code,
    anyE?.error?.type,
    anyE?.error?.error?.type,
    anyE?.name,
  ];
  const found = candidates.find((c) => typeof c === "string" && c.length > 0);
  return typeof found === "string" ? found : "";
}

/** Classify any caught adapter error into the shared taxonomy. Never throws.
 *  Order matters: a status code is the most reliable signal, then a provider
 *  error code/type string, then a keyword scan of the message as a last
 *  resort (covers the hand-rolled Perplexity HTTP error and network errors
 *  that carry neither). */
export function classifyAdapterError(e: unknown): ClassifiedError {
  const message = e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500);
  const status = extractStatus(e);
  const code = extractCode(e).toLowerCase();
  const name = e instanceof Error ? e.name.toLowerCase() : "";
  const hay = `${message} ${code} ${name}`.toLowerCase();

  if (status === 401 || status === 403 || /auth|permission_denied|api key/.test(hay)) {
    // Gemini's 403 is usually "API not enabled" rather than a bad key —
    // packages/cli/src/errors.ts words the Gemini "auth" message accordingly.
    return { kind: "auth", status, message };
  }
  if (status === 402 || /insufficient_quota|billing|no credit/.test(hay)) {
    return { kind: "quota", status, message };
  }
  if (status === 429 || /rate_limit|resource_exhausted|too many requests/.test(hay)) {
    return { kind: "rate_limit", status, message };
  }
  if (status === 404 || /model_not_found|not_found|does not exist/.test(hay)) {
    return { kind: "not_found", status, message };
  }
  if (
    (typeof status === "number" && status >= 500) ||
    name === "aborterror" ||
    /timeout|timed out|overloaded|unavailable|econnreset|enotfound/.test(hay)
  ) {
    return { kind: "server", status, message };
  }
  return { kind: "unknown", status, message };
}

// ---------------------------------------------------------------------------
// A provider's raw error text can EMBED the API key. Gemini's REST
// transport puts it in the request URL (`...?key=AIza...`), and several SDKs
// echo an Authorization header back in a debug message. That string is copied
// verbatim into AnswerRow.error (observe.ts), so it reaches run.json, the
// report, status.json and Inngest step state. Redact it HERE, at the one
// boundary every adapter's error passes through, so nothing downstream has to
// remember to.
//
// Two sources, both needed: the exact key values this process holds (the CLI's
// applyKeysToEnv / the app's provider settings put them in process.env before
// any adapter runs), and the generic shapes, which cover a key that arrived by
// some other route. Mirrors packages/cli/src/redact.ts's shape list — two tiny
// copies rather than an engine->CLI (or CLI->engine barrel) import.
// ---------------------------------------------------------------------------

const KEY_ENV_VARS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENAI_API_KEY",
  "PERPLEXITY_API_KEY",
] as const;

export const SECRET_SHAPES: readonly RegExp[] = [
  // The left boundary is load-bearing: without it `sk-` matches INSIDE ordinary
  // words — Tailwind's own `mask-linear-from-...` class names are the case that
  // bit us — and the "safety net" silently corrupts legitimate prose.
  // Kept byte-identical to packages/cli/src/redact.ts's copy.
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{12,}/g, // OpenAI + Anthropic (sk-ant-...) + look-alikes
  /pplx-[A-Za-z0-9_-]{12,}/g, // Perplexity
  /AIza[0-9A-Za-z_-]{16,}/g, // Google / Gemini
  /(?<=\b(?:bearer|token)\s)[A-Za-z0-9._~+/-]{16,}={0,2}/gi, // Authorization echoes
  /(?<=\b(?:api[-_]?key|access[-_]?token|auth|key)=)[^&\s"'`]{8,}/gi, // ...?key=<secret>
];

/** Replace every known key value and every generic secret shape in `text`. */
export function redactSecretsInText(text: string): string {
  let out = text;
  for (const name of KEY_ENV_VARS) {
    const value = process.env[name];
    if (value && value.length >= 6) out = out.split(value).join("[redacted]");
  }
  for (const shape of SECRET_SHAPES) {
    out = out.replace(new RegExp(shape.source, shape.flags), "[redacted]");
  }
  return out;
}

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
