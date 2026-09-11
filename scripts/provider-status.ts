// Builds the provider status page — one minimal call per
// CONFIGURED provider, on the registry's default models (same call shape as
// scripts/smoke-adapters.ts: one question, no maxSearches override). Writes
// website/public/status/status.json for website/content/docs/status.mdx to
// statically import at build. Run by .github/workflows/provider-status.yml
// weekly + on demand, on the MAINTAINER's own keys — never in this repo's
// CI/PR gate, and never with a live call in this task's own verification
// (see --dry-run below).
//
//   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scripts/provider-status.ts
//   npx tsx --tsconfig scripts/tsconfig.json scripts/provider-status.ts --dry-run   # prints the plan, calls nothing, $0
//
// A provider with no key set is reported as {ok:false, error:"not_configured"}
// WITHOUT calling its adapter at all (not even the adapter's own free
// missing-key short-circuit) — the distinction between "not configured" and
// "configured but the live call failed" is worth keeping explicit here.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ADAPTERS } from "@saylent/engine/adapters";
import { MODELS } from "@saylent/engine/models";
import type { Engine } from "@saylent/engine/types";

const QUESTION = "What is the best CDN for a high-traffic SaaS in 2026?";

const OUT_PATH = join(process.cwd(), "website", "public", "status", "status.json");

/** provider id (matches the *_API_KEY env var family, and
 *  src/lib/provider-settings.ts PROVIDER_META) -> the answer engine + the
 *  registry's default model that serves it. */
const PROVIDERS: Record<string, { engine: Engine; model: string; apiKey: string | undefined }> = {
  openai: { engine: "chatgpt", model: MODELS.chatgptAnswer, apiKey: process.env.OPENAI_API_KEY },
  anthropic: { engine: "claude", model: MODELS.claudeAnswer, apiKey: process.env.ANTHROPIC_API_KEY },
  gemini: { engine: "gemini", model: MODELS.geminiAnswer, apiKey: process.env.GEMINI_API_KEY },
  perplexity: { engine: "perplexity", model: MODELS.perplexityAnswer, apiKey: process.env.PERPLEXITY_API_KEY },
};

interface ProviderStatus {
  model: string;
  ok: boolean;
  latency_ms: number | null;
  error?: string;
}

// P4 security review #4: a provider's raw error string can embed the API key
// itself (e.g. the Gemini adapter puts the key in the request URL, so a fetch
// failure's message repeats that URL verbatim) — this file writes `error`
// straight into website/public/status/status.json, which is COMMITTED and
// PUBLIC. Redact every configured key's literal value, then sweep for the
// secret shapes a key can take even when it isn't one of ours (a stray token
// embedded in some other part of a provider's error body). Exported so the
// test can drive it without spending a live call.
const SECRET_SHAPE_PATTERNS: RegExp[] = [
  // OpenAI/Anthropic-style bare keys: sk-..., sk-ant-...
  /sk-[A-Za-z0-9_-]{10,}/g,
  // Google-style API keys (Gemini's URL-embedded ?key=AIza...).
  /AIza[A-Za-z0-9_-]{20,}/g,
  // `key=...` / `api_key=...` / `apikey=...` query-param or assignment form.
  /\b(?:api[_-]?key|key)\s*=\s*[A-Za-z0-9._-]{10,}/gi,
  // `Authorization: Bearer <token>` / `Bearer <token>` anywhere in a message.
  /\bBearer\s+[A-Za-z0-9._-]{10,}/gi,
];

/** Redacts every configured provider key's literal value, then the generic
 *  secret shapes above. `keys` is this run's own set of configured API keys —
 *  never a hard-coded list, so a redaction never goes stale as providers are
 *  added. */
export function redactProviderError(error: string | undefined, keys: readonly (string | undefined)[]): string | undefined {
  if (!error) return error;
  let out = error;
  for (const key of keys) {
    if (!key || key.length < 6) continue; // too short to be a real key; avoid mangling normal text
    out = out.split(key).join("[redacted]");
  }
  for (const pattern of SECRET_SHAPE_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  return out;
}

interface StatusFile {
  checked_at: string;
  providers: Record<string, ProviderStatus>;
  cli_version: string;
}

function cliVersion(): string {
  try {
    const raw = readFileSync(join(process.cwd(), "packages", "cli", "package.json"), "utf8");
    return (JSON.parse(raw) as { version: string }).version;
  } catch {
    return "unknown";
  }
}

async function checkProvider(cfg: { engine: Engine; model: string; apiKey?: string }): Promise<ProviderStatus> {
  if (!cfg.apiKey) {
    return { model: cfg.model, ok: false, latency_ms: null, error: "not_configured" };
  }
  const started = Date.now();
  const r = await ADAPTERS[cfg.engine](QUESTION, { model: cfg.model, apiKey: cfg.apiKey });
  const latency_ms = Date.now() - started;
  const allKeys = Object.values(PROVIDERS).map((p) => p.apiKey);
  return r.ok
    ? { model: cfg.model, ok: true, latency_ms }
    : { model: cfg.model, ok: false, latency_ms, error: redactProviderError(r.error, allKeys) };
}

function printPlan(): void {
  console.log(`Q: ${QUESTION}\n`);
  console.log("provider-status --dry-run: no calls will be made, $0 spent.\n");
  for (const [id, cfg] of Object.entries(PROVIDERS)) {
    const configured = Boolean(cfg.apiKey);
    console.log(
      `${id.padEnd(12)} engine=${cfg.engine.padEnd(10)} model=${cfg.model.padEnd(20)} ${
        configured ? "configured" : "NOT configured (would report not_configured)"
      }`,
    );
  }
  console.log(`\nWould write: ${OUT_PATH}`);
}

async function main() {
  if (process.argv.includes("--dry-run")) {
    printPlan();
    return;
  }

  const entries = Object.entries(PROVIDERS);
  const results = await Promise.all(
    entries.map(async ([id, cfg]) => [id, await checkProvider(cfg)] as const),
  );
  const providers: Record<string, ProviderStatus> = {};
  for (const [id, status] of results) providers[id] = status;

  const payload: StatusFile = {
    checked_at: new Date().toISOString(),
    providers,
    cli_version: cliVersion(),
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + "\n");

  const configured = Object.values(providers).filter((p) => p.error !== "not_configured");
  const okCount = configured.filter((p) => p.ok).length;
  console.log(`provider-status: ${okCount}/${configured.length} configured providers ok. Wrote ${OUT_PATH}`);
}

// tsx runs this file directly; the redaction export above exists for the unit
// test, which must not trigger a live run (or process.exit) just by importing
// this module.
if (process.argv[1]?.endsWith("provider-status.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
