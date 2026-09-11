// "Keys are never printed, never written into run.json or any
// report, redacted from logs and error output." One small helper applied
// everywhere a string could reach the terminal, a thrown error, or a file.
import { glyph } from "./glyphs";

export function redactSecrets(text: string, secrets: readonly (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) {
    if (!s || s.length < 6) continue; // never redact something too short to be a real key
    out = out.split(s).join("[redacted]");
  }
  return out;
}

/** Wrap a thrown error's message with redaction applied, preserving the
 *  original as `cause` for anyone who genuinely needs it (never printed). */
export function redactError(e: unknown, secrets: readonly (string | undefined)[]): Error {
  const message = e instanceof Error ? e.message : String(e);
  return new Error(redactSecrets(message, secrets), { cause: e });
}

/** "sk-abc123...xyz9" -> "sk-a…z9" — for `keys list`, never the full value. */
export function maskKey(key: string): string {
  if (key.length <= 8) return glyph("dot").repeat(Math.max(4, key.length));
  return `${key.slice(0, 4)}${glyph("ellipsis")}${key.slice(-2)}`;
}

// ---------------------------------------------------------------------------
// process-wide registry: every key resolved this run gets registered once
// (keys.ts's applyKeysToEnv does this), so ANY later error message — an SDK
// exception, a fetch failure whose message happens to embed a request URL
// with the key as a query param (the Gemini "keys test" call does this) — can
// be redacted at the single place errors reach the terminal (index.ts's
// top-level catch) without threading the key list through every call site.
// ---------------------------------------------------------------------------
const knownSecrets = new Set<string>();

export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 6) knownSecrets.add(value);
}

// the registry only knows the keys THIS process resolved. A provider
// error, a bundle or a report can still carry a key that arrived by another
// route (a .env the CLI never parsed, a key echoed back inside a request URL
// by an SDK). These shapes are the safety net, applied on top of the exact
// values. Mirrors packages/engine/src/adapters/shared.ts's SECRET_SHAPES —
// two tiny copies rather than making the CLI's startup path import the engine.
export const SECRET_SHAPES: readonly RegExp[] = [
  // The left boundary is load-bearing: without it `sk-` matches INSIDE ordinary
  // words — Tailwind's own `mask-linear-from-...` class names are the case that
  // bit us — and the "safety net" silently corrupts legitimate prose.
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{12,}/g, // OpenAI + Anthropic (sk-ant-...) + look-alikes
  /pplx-[A-Za-z0-9_-]{12,}/g, // Perplexity
  /AIza[0-9A-Za-z_-]{16,}/g, // Google / Gemini
  /(?<=\b(?:bearer|token)\s)[A-Za-z0-9._~+/-]{16,}={0,2}/gi, // Authorization echoes
  /(?<=\b(?:api[-_]?key|access[-_]?token|auth|key)=)[^&\s"'`]{8,}/gi, // ...?key=<secret>
];

/** Replace anything SHAPED like a provider key, whether or not we hold it. */
export function redactSecretShapes(text: string): string {
  let out = text;
  for (const shape of SECRET_SHAPES) {
    out = out.replace(new RegExp(shape.source, shape.flags), "[redacted]");
  }
  return out;
}

/** The one call every log line, error message, serialized bundle and rendered
 * report goes through before it is printed or written . */
export function redactKnownSecrets(text: string): string {
  return redactSecretShapes(redactSecrets(text, [...knownSecrets]));
}

/**
 * Redact every STRING inside a data structure, leaving the structure itself
 * (and every non-string leaf) untouched.
 *
 * WHY THIS EXISTS — the launch bug it fixes. `redactKnownSecrets` used to be
 * applied to the finished report.html on its way to disk. That file embeds an
 * ~800 KB minified React/Tailwind hydration bundle, and the shape regexes are
 * blind to the difference between prose and code: they rewrote `this.key=t`
 * into `key=[redacted]` and Tailwind's `mask-linear-from-…` into `ma[redacted]`,
 * so the bundle threw `SyntaxError: Invalid left-hand side in assignment`, never
 * hydrated, and the whole report sat at opacity 0.
 *
 * The fix is to redact the INPUTS instead of the output: every string that the
 * renderer will place into the data island and the server-rendered markup goes
 * through here first, and the rendered document — bundle included — is written
 * verbatim. Same guarantee, applied where the data is still data.
 */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactKnownSecrets(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  // plain objects only: Date/Map/RegExp/class instances are left alone rather
  // than being silently rebuilt as bare objects.
  if (value !== null && typeof value === "object" && isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out as unknown as T;
  }
  return value;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Test-only: clear the registry so tests don't leak state into each other. */
export function clearRegisteredSecrets(): void {
  knownSecrets.clear();
}
