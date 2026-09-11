// Config loader (see ARCHITECTURE.md, "Configure" level): a project can drop
// a `saylent.config.{json,js,mjs,ts}` in its cwd to customize competitors, the
// answer-engine set, the default profile, the crawler's user agent and branding —
// with NO code required. Every field is optional (a project with no config file
// gets the shipped defaults, computed by the CALLER, not here).
//
// Every field below is LIVE: questionTemplates is read by questions.ts,
// models by models.ts, extraBots by domainChecks.ts, thresholds.coverage by
// coverage.ts and thresholds.fixWeights by fixes.ts. Absent config = the
// shipped defaults, byte for byte.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const require_ = createRequire(import.meta.url);

const engineEnum = z.enum(["chatgpt", "claude", "gemini", "perplexity"]);
const profileEnum = z.enum(["full", "smoke"]);
const botKindEnum = z.enum(["training", "search", "user"]);

/** One template key's override: replace its phrasings, change its quota, or
 *  both. A key that is not one of the shipped question types adds a NEW group
 *  whose questions are typed "custom" (asked and judged, never scored). */
export const questionTemplateOverrideSchema = z.object({
  templates: z.array(z.string().min(1)).min(1).optional(),
  quota: z.number().int().min(0).max(50).optional(),
});

/** models: which model serves which role. Precedence is
 *  CLI flag > MODEL_* env var > this config > the shipped registry default. */
export const modelSelectionSchema = z.object({
  judge: z.object({ anthropic: z.string().optional(), openai: z.string().optional() }).optional(),
  brand: z.string().optional(),
  drafter: z.string().optional(),
  engines: z
    .object({
      chatgpt: z.string().optional(),
      claude: z.string().optional(),
      gemini: z.string().optional(),
      perplexity: z.string().optional(),
    })
    .optional(),
});

/** An extra bot for the robots.txt registry: the user agent plus its class
 *  (training = blocking is a legitimate choice; search/user = blocking costs
 *  citations or live page reads). `impact` is the sentence the report prints. */
export const extraBotSchema = z.object({
  agent: z.string().min(1),
  kind: botKindEnum,
  impact: z.string().optional(),
});

/** sampling: how many times each SCORED question is asked (Samples feature).
 *  Precedence everywhere it is resolved: CLI `--samples` flag > `AUDIT_SAMPLES`
 *  env > this config > the profile default (profiles.ts scoredSamples). A
 *  per-question `samples` field on a `--questions` row wins over all of these
 *  for that one question (questions-file.ts / profiles.ts sampleCountFor).
 *  `tiebreak` only ever matters when the EFFECTIVE count for a question is
 *  exactly 2 (the historical "third draw only on disagreement" rule); it can
 *  turn that third draw off, never force it on for n=1 or n>=3. */
export const samplingConfigSchema = z.object({
  samples: z.number().int().min(1).max(5).optional(),
  tiebreak: z.boolean().optional(),
});

/** Skip the costly stages by default for this
 *  project. Same shape as RunAuditInput.skip (types.ts SkipStages) / the
 *  CLI's `--skip`/`AUDIT_SKIP` (profiles.ts resolveSkip): `--skip` flag >
 *  `AUDIT_SKIP` env > this config > none. */
export const skipStagesSchema = z.object({
  drafts: z.boolean().optional(),
  corpus: z.boolean().optional(),
  gates: z.boolean().optional(),
});

export const thresholdsSchema = z.object({
  /** coverage.ts COVERAGE_THRESHOLD (0-1). Default 0.45. */
  coverage: z.number().min(0).max(1).optional(),
  /** fixes.ts FIX_WEIGHTS, partial: only the families you name change. */
  fixWeights: z.record(z.string(), z.number().min(0).max(10)).optional(),
});

export const saylentConfigSchema = z.object({
  /** replaces/extends the shipped buyer-question templates, by key (questions.ts) */
  questionTemplates: z.record(z.string(), questionTemplateOverrideSchema).optional(),
  /** which model serves which role (models.ts) */
  models: modelSelectionSchema.optional(),
  /** seeded competitor domains/names, merged with whatever buildBrandModel derives */
  competitors: z.array(z.string()).optional(),
  /** the answer-engine subset to ask (see METHODOLOGY.md) */
  engines: z.array(engineEnum).optional(),
  /** default profile a run uses when the caller doesn't override it */
  profile: profileEnum.optional(),
  /** run-level default sample count + tiebreak for scored questions */
  sampling: samplingConfigSchema.optional(),
  /** Skip drafting / corpus fetches / gate
   *  checks by default for this project (profiles.ts resolveSkip). */
  skip: skipStagesSchema.optional(),
  /** crawler UA string (default: SaylentAudit/<version> (+<docs url>), util.ts).
   *  Read by the CLI's crawler fetcher wrapper (packages/cli/src/run.ts
   *  buildCrawlerFetcher) — applies to the whole run's safeFetch seam
   *  (crawl, corpus, domain checks), not just crawl.ts. */
  userAgent: z.string().optional(),
  /** Caps how many crawled pages feed the brand
   *  model and corpus (packages/cli/src/run.ts's onSitePages hook truncates
   *  the crawl's own result to this count post-crawl; the crawl itself still
   *  makes up to the profile's own page budget worth of requests — see
   *  run.ts buildCrawlerHooks). Absent = no cap beyond the profile default. */
  maxPages: z.number().int().min(1).max(200).optional(),
  /** Skip the SSRF private-IP guard for the
   *  audited site's own host (and its www/apex sibling) ONLY — never for a
   *  citation/corpus URL on another host, and never on by default. Read by
   *  the CLI's buildCrawlerFetcher (packages/cli/src/run.ts). */
  allowPrivate: z.boolean().optional(),
  /** extra bots merged into the BOT_REGISTRY robots.txt checks (domainChecks.ts) */
  extraBots: z.array(extraBotSchema).optional(),
  /** coverage / fix-weight overrides (coverage.ts, fixes.ts) */
  thresholds: thresholdsSchema.optional(),
  branding: z
    .object({
      appName: z.string().optional(),
      contactEmail: z.string().optional(),
    })
    .optional(),
  /** BCP47 tag. Read by the CLI's --locale
   *  plumbing (packages/cli/src/commands/audit.ts): when set, run.ts's
   *  buildCrawlerHooks translates the freshly-generated question set once
   *  via the drafter role and marks each translated question `translated:
   *  true`. No effect on a reused/frozen --questions set or on `verify`
   *  (nothing generates a new question set there). */
  locale: z.string().optional(),
});

export type SaylentConfig = z.infer<typeof saylentConfigSchema>;
export type QuestionTemplateOverride = z.infer<typeof questionTemplateOverrideSchema>;
export type QuestionTemplateConfig = Record<string, QuestionTemplateOverride>;
export type ModelSelection = z.infer<typeof modelSelectionSchema>;
export type ExtraBot = z.infer<typeof extraBotSchema>;
export type ConfigThresholds = z.infer<typeof thresholdsSchema>;
export type SamplingConfig = z.infer<typeof samplingConfigSchema>;
export type SkipConfig = z.infer<typeof skipStagesSchema>;

export interface LoadedConfig {
  config: SaylentConfig;
  /** absolute path of the config file that was loaded, or null when none exists */
  source: string | null;
}

const EMPTY: LoadedConfig = { config: {}, source: null };

/** Strip a leading `export default` / `module.exports =` marker so a config
 *  authored either way loads the same object. Only used for the LAST-RESORT
 *  plain-object literal fallback below (not for real .js/.mjs execution). */
function parseValue(mod: unknown): unknown {
  if (mod && typeof mod === "object" && "default" in (mod as Record<string, unknown>)) {
    return (mod as { default: unknown }).default;
  }
  return mod;
}

async function loadJson(file: string): Promise<unknown> {
  const text = await readFile(file, "utf8");
  return JSON.parse(text);
}

async function loadJsOrMjs(file: string): Promise<unknown> {
  const mod = (await import(pathToFileURL(file).href)) as unknown;
  return parseValue(mod);
}

/** A tiny standalone script, run in a CHILD process under `node --import tsx`,
 *  that imports the (.ts) config and prints it as JSON on stdout. Kept as a
 *  string (not a checked-in file) so config.ts stays the only new file here. */
const TS_LOADER_SCRIPT = `
import { pathToFileURL } from "node:url";
// With --eval, argv has no script-path slot: argv[0] is the node binary and
// the first EXTRA positional arg (the config path passed after --eval) lands
// at argv[1] (verified against this Node's actual behavior, not assumed).
const target = process.argv[1];
let value = await import(pathToFileURL(target).href);
// tsx's CJS<->ESM interop can wrap a plain "export default {...}" in an extra
// .default layer (verified empirically: {default:{default:{...}}}). Unwrap
// while it looks wrapped, bounded so a config that legitimately has no
// "default" key (or one that IS itself the string "default") can't loop.
for (let i = 0; i < 5; i++) {
  if (!value || typeof value !== "object" || !("default" in value)) break;
  value = value.default;
}
process.stdout.write(JSON.stringify(value ?? {}));
`;

/** true when `tsx` resolves from this process's module graph — i.e. it is
 *  installed somewhere up the tree (root devDependency in this monorepo; a
 *  project consuming the CLI standalone may not have it, in which case a
 *  `saylent.config.ts` is skipped in favor of .json/.js/.mjs. */
function tsxAvailable(): boolean {
  try {
    require_.resolve("tsx");
    return true;
  } catch {
    return false;
  }
}

/** Load a `.ts` config by spawning `node --import tsx --input-type=module
 *  --eval <loader>` and reading back the JSON it prints. Throws when tsx is
 *  unavailable — callers should check tsxAvailable() first and skip instead. */
function loadTsViaTsx(file: string): unknown {
  const out = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", TS_LOADER_SCRIPT, file],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(out || "{}");
}

const CANDIDATES = ["saylent.config.json", "saylent.config.js", "saylent.config.mjs", "saylent.config.ts"];

/** The three candidates that EXECUTE code when loaded. Importing
 *  `saylent.config.js` runs whatever is in it; `saylent.config.ts` additionally
 *  spawns a child `node --import tsx`. That is fine for the CLI (a human typed
 *  `saylent audit` in a directory they chose) and NOT fine for the MCP server,
 *  where an agent picks the working directory and merely listing a tool can end
 *  up executing a file the user never opened. */
const EXECUTABLE_CANDIDATES: ReadonlySet<string> = new Set([
  "saylent.config.js",
  "saylent.config.mjs",
  "saylent.config.ts",
]);

export interface LoadConfigOptions {
  /** Allow `saylent.config.{js,mjs,ts}` (which execute on load).
   *  Default true, so the CLI is unchanged; the MCP server passes false and
   *  gets `saylent.config.json` only. */
  allowExecutable?: boolean;
  /** Called once per executable config file skipped because
   *  `allowExecutable` was false — the caller decides how to say so (the MCP
   *  server turns it into a log notification; config.ts never prints). */
  onSkipped?: (file: string) => void;
}

/** Find + parse + validate `saylent.config.{json,js,mjs,ts}` in `cwd`. Returns
 *  `{config: {}, source: null}` when no file is present. Throws a clear error
 *  when a file exists but fails to parse or fails schema validation — a
 *  malformed config should stop the CLI, not silently fall back to defaults. */
export async function loadConfig(cwd: string, opts: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const { allowExecutable = true, onSkipped } = opts;
  for (const name of CANDIDATES) {
    const file = path.join(cwd, name);
    if (!existsSync(file)) continue;
    if (!allowExecutable && EXECUTABLE_CANDIDATES.has(name)) {
      onSkipped?.(file);
      continue;
    }

    let raw: unknown;
    try {
      if (name.endsWith(".json")) raw = await loadJson(file);
      else if (name.endsWith(".ts")) {
        if (!tsxAvailable()) {
          throw new Error(
            "saylent.config.ts found, but `tsx` is not installed. " +
              "Install tsx, or use saylent.config.json / saylent.config.js instead.",
          );
        }
        raw = loadTsViaTsx(file);
      } else {
        raw = await loadJsOrMjs(file);
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new Error(`saylent config: failed to load ${file}: ${reason}`);
    }

    const parsed = saylentConfigSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where = first?.path.join(".") || "(root)";
      throw new Error(`saylent config: invalid at ${where} in ${file}: ${first?.message ?? "unknown error"}`);
    }
    return { config: parsed.data, source: file };
  }
  return EMPTY;
}

/** config < env < flags precedence (see ARCHITECTURE.md):
 *  a later, more-specific source's value wins field by field; `undefined`
 *  never overwrites an earlier value. Pure — the caller decides what counts
 *  as "env" vs "flags" and passes them in that order. */
export function mergeConfig(...layers: (Partial<SaylentConfig> | undefined)[]): SaylentConfig {
  const out: SaylentConfig = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const key of Object.keys(layer) as (keyof SaylentConfig)[]) {
      const value = layer[key];
      if (value !== undefined) (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}
