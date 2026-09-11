// The goal: "provider errors look like our bug". Every
// adapter (packages/engine/src/adapters/*.ts) classifies its caught error via
// shared.ts's classifyAdapterError and stamps AskResult.error as
// "<AdapterErrorKind>: <message>" — the one channel that survives verbatim
// into AnswerRow.error (observe.ts copies it through unchanged) and therefore
// into RunResult.answers[].error, which is all packages/cli/src/progress.ts
// has to work with. This module owns the per-(provider, kind) plain-sentence
// + one-action map progress.ts prints, once per failed engine.
import type { Engine } from "@saylent/engine";
import { redactKnownSecrets } from "./redact";

export type AdapterErrorKind =
  | "missing_key"
  | "auth"
  | "quota"
  | "rate_limit"
  | "not_found"
  | "server"
  | "unknown";

const KNOWN_KINDS: ReadonlySet<string> = new Set([
  "missing_key",
  "auth",
  "quota",
  "rate_limit",
  "not_found",
  "server",
  "unknown",
]);

/** Parse the "<kind>: <message>" tag shared.ts writes into AskResult.error
 *  (and, unchanged all the way through, AnswerRow.error). A string with no
 *  recognized prefix — an older bundle, a hand-edited one, anything odd — is
 *  treated as "unknown" rather than throwing. */
export function parseAdapterError(raw: string): { kind: AdapterErrorKind; message: string } {
  const i = raw.indexOf(": ");
  if (i > 0) {
    const kind = raw.slice(0, i);
    if (KNOWN_KINDS.has(kind)) return { kind: kind as AdapterErrorKind, message: raw.slice(i + 2) };
  }
  return { kind: "unknown", message: raw };
}

const PROVIDER_LABEL: Record<Engine, string> = {
  chatgpt: "OpenAI",
  claude: "Anthropic",
  gemini: "Gemini",
  perplexity: "Perplexity",
};

type MessageFn = (ctx: { modelName?: string }) => string;

const NOT_FOUND: MessageFn = ({ modelName }) =>
  modelName
    ? `Model \`${modelName}\` was not found. Run \`saylent models\` and override with \`--model <role>=<model>\`.`
    : "That model was not found. Run `saylent models` and override with `--model <role>=<model>`.";

// One entry per (engine, kind) — the exact wording for OpenAI, mirrored for
// the other three families with each provider's own key-test/billing/quirk
// language (Gemini's 403 usually means the API isn't enabled, not a bad key;
// Perplexity's 429 is common on a
// brand-new key).
const MESSAGES: Record<Engine, Partial<Record<AdapterErrorKind, MessageFn>>> = {
  chatgpt: {
    missing_key: () => "No OpenAI key configured. Run `saylent keys` to add one.",
    auth: () => "Your OpenAI key was rejected. Check it with `saylent keys test`.",
    quota: () =>
      "Your OpenAI account has no credit. Add credit at platform.openai.com/settings/billing, then rerun.",
    rate_limit: () => "OpenAI rate-limited this run. Retrying with backoff; lower `--samples` or wait a minute.",
    not_found: NOT_FOUND,
    server: () => "OpenAI is having trouble. The other engines continue.",
  },
  claude: {
    missing_key: () => "No Anthropic key configured. Run `saylent keys` to add one.",
    auth: () => "Your Anthropic key was rejected. Check it with `saylent keys test`.",
    quota: () =>
      "Your Anthropic account has no credit. Add credit at console.anthropic.com/settings/billing, then rerun.",
    rate_limit: () => "Anthropic rate-limited this run. Retrying with backoff; lower `--samples` or wait a minute.",
    not_found: NOT_FOUND,
    server: () => "Anthropic is having trouble. The other engines continue.",
  },
  gemini: {
    missing_key: () => "No Gemini key configured. Run `saylent keys` to add one.",
    auth: () =>
      "Gemini rejected this request — usually the Generative Language API isn't enabled for this key's " +
      "project (enable it at aistudio.google.com), not a bad key. Check the key itself with `saylent keys test`.",
    quota: () =>
      "Your Gemini account has no quota left. Check billing/quota at aistudio.google.com/app/apikey, then rerun.",
    rate_limit: () => "Gemini rate-limited this run. Retrying with backoff; lower `--samples` or wait a minute.",
    not_found: NOT_FOUND,
    server: () => "Gemini is having trouble. The other engines continue.",
  },
  perplexity: {
    missing_key: () => "No Perplexity key configured. Run `saylent keys` to add one.",
    auth: () => "Your Perplexity key was rejected. Check it with `saylent keys test`.",
    quota: () => "Your Perplexity account has no credit. Add credit at perplexity.ai/settings/api, then rerun.",
    rate_limit: () =>
      "Perplexity rate-limited this run — common on a brand-new key. Retrying with backoff; lower `--samples` or wait a minute.",
    not_found: NOT_FOUND,
    server: () => "Perplexity is having trouble. The other engines continue.",
  },
};

/** The ONE plain sentence + ONE action for this engine's failure.
 *  `modelName` — the resolved answer model for
 *  this engine, when known — fills the not_found message. Falls back to the
 *  raw (truncated) message for a kind/engine combination with no template. */
export function mapProviderError(engine: Engine, rawError: string, modelName?: string): string {
  const { kind, message } = parseAdapterError(rawError);
  const fn = MESSAGES[engine]?.[kind];
  if (fn) return fn({ modelName });
  const label = PROVIDER_LABEL[engine];
  // The only branch that prints a provider's RAW words. A Gemini
  // transport error carries the key in the URL it echoes, so this fallback
  // (and nothing above it, which is all fixed copy) is redacted.
  return redactKnownSecrets(`${label} returned an error: ${message.slice(0, 160)}`);
}
