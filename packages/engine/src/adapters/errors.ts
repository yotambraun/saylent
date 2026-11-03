// Adapter error taxonomy and secret redaction, split out of shared.ts so code
// outside the adapters (llm.ts's failure log) can use them without importing
// shared.ts's citation helpers and, through them, cheerio. Pure; no imports.
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
  /** an answer surface showed no answer for the question (adapters/serp.ts
   *  notShown): a coverage gap, never a provider failure */
  | "no_answer"
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
  "SERPAPI_API_KEY",
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
