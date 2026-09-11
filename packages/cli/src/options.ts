// ONE shared `AuditOptions` zod schema for both
// doors the CLI opens onto the same pipeline: the `audit`/`verify` command
// parsers (commands/audit.ts, commands/verify.ts) and the MCP tool input
// (mcp/server.ts's `registerTool` inputSchema). Both surfaces read their
// field set, types and descriptions from THIS file, so they can never drift
// apart — a flag/argument either exists here or it doesn't exist on either
// surface.
//
// Three things this module owns:
//   1. AuditOptionsSchema / VerifyOptionsSchema — the canonical shape (and
//      the ONE place each field's description is written — every zod field
//      below carries its own `.describe()`, reused verbatim by both the MCP
//      inputSchema (server.ts passes `.shape` straight through) and
//      `describeOptions()` (CLI help rows, the parity test, the docs table).
//   2. cliParseOptions() — turns the schema's CLI-visible fields into a
//      `node:util` `parseArgs` `options` record, so audit.ts/verify.ts build
//      their parser from this file instead of a hand-duplicated list. Fields
//      with no CLI flag (`domain`, positional) or already covered by
//      model-flags.ts's MODEL_FLAG_OPTIONS (`judge`/`judge_family`/`models`,
//      the repeatable `--model role=model` flag has no simple string/boolean
//      shape) are skipped here and added by the caller instead — see
//      commands/audit.ts and commands/verify.ts.
//   3. toRunOptions() — the one function BOTH surfaces call to turn a
//      validated AuditOptions/VerifyOptions object into the normalized,
//      engine-ready pieces run.ts's AuditOptions/VerifyOptions (the PIPELINE
//      input shape, a different type of the same name in a different module)
//      actually take: a resolved ModelSelection, a SkipStages object
//      regardless of whether `skip` arrived as `{drafts,corpus,gates}` or
//      `["drafts","gates"]`, and the validated crawler block (locale/
//      max_pages/user_agent/allow_private). This file never calls the
//      pipeline itself — see run.ts's TESTABILITY NOTE for why that logic
//      stays there, not here.
import { z } from "zod";
import type { Engine } from "@saylent/engine";
import type { ModelSelection } from "@saylent/engine/config";
import type { SkipStages } from "@saylent/engine";
import { MODEL_ROLES, type FamilyOfModel } from "./model-flags";
import type { CrawlerOptions } from "./run";

export { MODEL_ROLES };
export type { FamilyOfModel };

/** BCP47-ish language tag, e.g. "de" or "pt-BR" — shared by the CLI's
 *  `--locale` validation (commands/audit.ts) and the MCP schema below, so the
 *  two can never accept a different set of locale strings. */
export const BCP47_PATTERN = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

// ---------------------------------------------------------------------------
// descriptions — written ONCE, reused by the MCP inputSchema (the zod
// `.describe()` calls below) and by describeOptions()'s CLI help rows / the
// generated integrations.mdx table.
// ---------------------------------------------------------------------------

export const OPTION_DESCRIPTIONS = {
  domain: "The brand's domain, for example example.com",
  brand: "Brand name (default: the domain)",
  competitors: "Competitor domains/names",
  profile: "smoke (default, 6 questions) or full (23 questions)",
  engines: "Which answer engines to ask: chatgpt, claude, gemini, perplexity",
  questions_file:
    "Path to a run.json bundle, a questions.json (from `saylent questions`), or a text file with one question per line, to reuse instead of generating a new set",
  questions:
    "Inline question rows to ask instead of generating a set ({id?, type?, text, samples?}). MCP only — the CLI takes a file path via the same --questions flag (questions_file above)",
  samples: "How many times each scored question is asked (1-5)",
  judge: "Judge model; its provider family is inferred from the name",
  judge_family: 'anthropic | openai, when the judge model name is ambiguous',
  models: "Per-role model overrides: brand, drafter, chatgpt, claude, gemini, perplexity",
  locale:
    'Translate the generated question set into this language once (e.g. "de", "pt-BR"), via the drafter model. No effect when a question set is reused (questions_file/questions)',
  user_agent: "Override the crawler's User-Agent for this run's fetches (crawl, corpus, domain checks)",
  max_pages: "Cap how many crawled pages feed the brand model and corpus (1-200)",
  allow_private:
    "Allow the audited site's own host (and its www/apex sibling) to resolve to a private/internal address, for a staging server on your own network. Never on by default",
  skip: "Skip costly stages: drafts, corpus, gates ({drafts,corpus,gates} or a list of stage names)",
  max_usd: "Refuse to run if the high cost estimate exceeds this many dollars",
  out_dir: "Output directory (default: ./<domain>/<YYYY-MM-DD>/)",
  format: "Which files to write: md (report.md), html (report.html, movement.html on a verify), json (run.json). Default: all three",
  dry_run:
    "Print the plan, the questions it would ask (template defaults, $0, no crawl) and the cost estimate. Spends nothing",
  no_brand_model:
    "Documented for parity with `saylent questions`; a dry run already always previews with template defaults, so this has no further effect on audit",
} as const;

// ---------------------------------------------------------------------------
// field-level schemas
// ---------------------------------------------------------------------------

const questionRowSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  text: z.string().min(1),
  samples: z.number().int().min(1).max(5).optional(),
});

const modelsSchema = z.object({
  brand: z.string().min(1).optional(),
  drafter: z.string().min(1).optional(),
  chatgpt: z.string().min(1).optional(),
  claude: z.string().min(1).optional(),
  gemini: z.string().min(1).optional(),
  perplexity: z.string().min(1).optional(),
});

const skipObjectSchema = z.object({
  drafts: z.boolean().optional(),
  corpus: z.boolean().optional(),
  gates: z.boolean().optional(),
});
const skipSchema = z.union([skipObjectSchema, z.array(z.enum(["drafts", "corpus", "gates"]))]);

// ---------------------------------------------------------------------------
// the shared schema
// ---------------------------------------------------------------------------

/** Fields — all optional except `domain`. */
export const AuditOptionsSchema = z.object({
  domain: z.string().min(1).describe(OPTION_DESCRIPTIONS.domain),
  brand: z.string().min(1).optional().describe(OPTION_DESCRIPTIONS.brand),
  competitors: z.array(z.string()).optional().describe(OPTION_DESCRIPTIONS.competitors),
  profile: z.enum(["smoke", "full"]).optional().describe(OPTION_DESCRIPTIONS.profile),
  engines: z
    .array(z.enum(["chatgpt", "claude", "gemini", "perplexity"]))
    .optional()
    .describe(OPTION_DESCRIPTIONS.engines),
  questions_file: z.string().min(1).optional().describe(OPTION_DESCRIPTIONS.questions_file),
  questions: z.array(questionRowSchema).optional().describe(OPTION_DESCRIPTIONS.questions),
  samples: z.number().int().min(1).max(5).optional().describe(OPTION_DESCRIPTIONS.samples),
  judge: z.string().min(1).optional().describe(OPTION_DESCRIPTIONS.judge),
  judge_family: z.enum(["anthropic", "openai"]).optional().describe(OPTION_DESCRIPTIONS.judge_family),
  models: modelsSchema.optional().describe(OPTION_DESCRIPTIONS.models),
  locale: z
    .string()
    .min(1)
    .regex(BCP47_PATTERN, 'expected a BCP47 tag, e.g. "de" or "pt-BR"')
    .optional()
    .describe(OPTION_DESCRIPTIONS.locale),
  user_agent: z.string().min(1).optional().describe(OPTION_DESCRIPTIONS.user_agent),
  max_pages: z.number().int().min(1).max(200).optional().describe(OPTION_DESCRIPTIONS.max_pages),
  allow_private: z.boolean().optional().describe(OPTION_DESCRIPTIONS.allow_private),
  skip: skipSchema.optional().describe(OPTION_DESCRIPTIONS.skip),
  max_usd: z.number().positive().optional().describe(OPTION_DESCRIPTIONS.max_usd),
  out_dir: z.string().min(1).optional().describe(OPTION_DESCRIPTIONS.out_dir),
  format: z.array(z.enum(["md", "html", "json"])).optional().describe(OPTION_DESCRIPTIONS.format),
  dry_run: z.boolean().optional().describe(OPTION_DESCRIPTIONS.dry_run),
  no_brand_model: z.boolean().optional().describe(OPTION_DESCRIPTIONS.no_brand_model),
});
export type AuditOptions = z.infer<typeof AuditOptionsSchema>;

/** `verify` only accepts the subset of AuditOptions it can act on (a verify
 *  reuses the baseline's frozen brand/questions/engines verbatim — see
 *  commands/verify.ts's HELP text for why user_agent/max_pages/allow_private/
 *  locale/skip are accepted-but-no-effect, for parity with a script that
 *  passes the same flags to both commands), plus `bundle_path` (the
 *  equivalent of `audit`'s positional `<domain>`). Reuses the SAME zod field
 *  instances as AuditOptionsSchema — same validation, same description,
 *  never two copies of either. */
export const VERIFY_FIELD_KEYS = [
  "format",
  "samples",
  "judge",
  "judge_family",
  "models",
  "locale",
  "user_agent",
  "max_pages",
  "allow_private",
  "skip",
  "max_usd",
] as const satisfies readonly (keyof AuditOptions)[];

export const VerifyOptionsSchema = z.object({
  bundle_path: z.string().min(1).describe("Path to the baseline run.json (or the directory containing it)"),
  format: AuditOptionsSchema.shape.format,
  samples: AuditOptionsSchema.shape.samples,
  judge: AuditOptionsSchema.shape.judge,
  judge_family: AuditOptionsSchema.shape.judge_family,
  models: AuditOptionsSchema.shape.models,
  locale: AuditOptionsSchema.shape.locale,
  user_agent: AuditOptionsSchema.shape.user_agent,
  max_pages: AuditOptionsSchema.shape.max_pages,
  allow_private: AuditOptionsSchema.shape.allow_private,
  skip: AuditOptionsSchema.shape.skip,
  max_usd: AuditOptionsSchema.shape.max_usd,
});
export type VerifyOptions = z.infer<typeof VerifyOptionsSchema>;

// ---------------------------------------------------------------------------
// CLI naming — canonical (MCP) key -> CLI flag name. `cliFlag: null` means
// "no CLI flag" (domain is the CLI's positional argument). `generatesCliOption:
// false` means an existing flag definition already covers it elsewhere
// (model-flags.ts's MODEL_FLAG_OPTIONS: --judge, --judge-family, the
// repeatable --model role=model) — cliParseOptions() below skips it so the
// two definitions never collide, but it still counts for the parity test and
// the docs table.
// ---------------------------------------------------------------------------

interface CliFieldMeta {
  cliFlag: string | null;
  cliKind?: "string" | "boolean";
  generatesCliOption?: boolean;
}

export const CLI_FIELD_META: Record<keyof AuditOptions, CliFieldMeta> = {
  domain: { cliFlag: null },
  brand: { cliFlag: "brand" },
  competitors: { cliFlag: "competitors" },
  profile: { cliFlag: "profile" },
  engines: { cliFlag: "engines" },
  questions_file: { cliFlag: "questions" },
  questions: { cliFlag: "questions", generatesCliOption: false },
  samples: { cliFlag: "samples" },
  judge: { cliFlag: "judge", generatesCliOption: false },
  judge_family: { cliFlag: "judge-family", generatesCliOption: false },
  models: { cliFlag: "model", generatesCliOption: false },
  locale: { cliFlag: "locale" },
  user_agent: { cliFlag: "user-agent" },
  max_pages: { cliFlag: "max-pages" },
  allow_private: { cliFlag: "allow-private", cliKind: "boolean" },
  skip: { cliFlag: "skip" },
  max_usd: { cliFlag: "max-usd" },
  out_dir: { cliFlag: "out" },
  format: { cliFlag: "format" },
  dry_run: { cliFlag: "dry-run", cliKind: "boolean" },
  no_brand_model: { cliFlag: "no-brand-model", cliKind: "boolean" },
};

type ParseArgOption = { type: "string" | "boolean"; default?: boolean };

/** The STATIC shape `cliParseOptions(Object.keys(AuditOptionsSchema.shape))`
 *  produces at runtime, hand-declared once as a type: `node:util`'s
 *  `parseArgs` infers its `values` return type from the STATIC (literal-key)
 *  shape of the `options` object passed in, which a spread of
 *  `cliParseOptions()`'s `Record<string, ParseArgOption>` return value can't
 *  provide (an index signature, not literal keys) — so commands/audit.ts
 *  casts `parseArgs()`'s `values` through this type instead. Keep this in
 *  sync with CLI_FIELD_META's `cliFlag`/`cliKind` above; parity.test.ts
 *  checks the field SET, not this type, so a drift here is a silent (but
 *  narrow, TypeScript-only) risk — see that file's coverage note. */
export interface AuditCliValues {
  brand?: string;
  competitors?: string;
  profile?: string;
  engines?: string;
  questions?: string;
  samples?: string;
  judge?: string;
  "judge-family"?: string;
  model?: string[];
  locale?: string;
  "user-agent"?: string;
  "max-pages"?: string;
  "allow-private"?: boolean;
  skip?: string;
  "max-usd"?: string;
  out?: string;
  format?: string;
  "dry-run"?: boolean;
  "no-brand-model"?: boolean;
}

/** The same, for `cliParseOptions(VERIFY_FIELD_KEYS)` — commands/verify.ts's
 *  accepted subset. */
export type VerifyCliValues = Pick<
  AuditCliValues,
  | "format"
  | "samples"
  | "judge"
  | "judge-family"
  | "model"
  | "locale"
  | "user-agent"
  | "max-pages"
  | "allow-private"
  | "skip"
  | "max-usd"
>;

/** Build a `node:util` `parseArgs` `options` record from the schema's
 *  CLI-visible fields — audit.ts passes every key, verify.ts passes
 *  VERIFY_FIELD_KEYS, so each command's parser is a direct read of this file
 *  instead of a hand-duplicated option list. */
export function cliParseOptions(keys: readonly (keyof AuditOptions)[]): Record<string, ParseArgOption> {
  const out: Record<string, ParseArgOption> = {};
  for (const key of keys) {
    const meta = CLI_FIELD_META[key];
    if (!meta.cliFlag || meta.generatesCliOption === false) continue;
    out[meta.cliFlag] = meta.cliKind === "boolean" ? { type: "boolean", default: false } : { type: "string" };
  }
  return out;
}

export interface DescribedField {
  key: string;
  cliFlag: string | null;
  description: string;
}

/** The same field list, shaped for the CLI --help rows / the parity test /
 *  the integrations.mdx MCP table — one read of AuditOptionsSchema's keys (or
 *  VERIFY_FIELD_KEYS), never a separately maintained list. */
export function describeOptions(keys: readonly (keyof AuditOptions)[] = Object.keys(
  AuditOptionsSchema.shape,
) as (keyof AuditOptions)[]): DescribedField[] {
  return keys.map((key) => ({
    key,
    cliFlag: CLI_FIELD_META[key].cliFlag,
    description: OPTION_DESCRIPTIONS[key],
  }));
}

// ---------------------------------------------------------------------------
// toRunOptions() — the one function both surfaces call to turn a validated
// AuditOptions/VerifyOptions into the normalized pieces run.ts's pipeline
// input takes.
// ---------------------------------------------------------------------------

export interface ResolvedRunOptions {
  competitors: string[];
  engines?: Engine[];
  /** --judge/--judge-family/--model (or the MCP judge/judge_family/models
   *  fields), resolved to the same ModelSelection shape models.ts takes. */
  modelSelection: ModelSelection;
  crawler: CrawlerOptions;
  /** normalized to the SkipStages object shape regardless of whether `skip`
   *  arrived as `{drafts,corpus,gates}` or `["drafts","gates"]`. */
  skip?: SkipStages;
  outDir?: string;
  format?: ("md" | "html" | "json")[];
  maxUsd?: number;
  dryRun: boolean;
  noBrandModel: boolean;
}

/** `models`/`judge`/`judge_family` -> ModelSelection (models.ts's shape).
 *  Deliberately separate from model-flags.ts's parseModelFlags: that module
 *  parses the CLI's OWN `--model <role>=<model>` string format and its error
 *  messages name the CLI flags verbatim (`--judge-family`, `--model ...`),
 *  pinned by model-flags.test.ts; this one resolves the shared schema's
 *  already-structured `models`/`judge`/`judge_family` fields (what the MCP
 *  tools receive directly, and what commands/audit.ts + commands/verify.ts
 *  build from their OWN parsed flags before calling toRunOptions()). */
export function resolveModelSelection(
  input: Pick<AuditOptions, "judge" | "judge_family" | "models">,
  familyOf: FamilyOfModel,
): ModelSelection {
  const selection: ModelSelection = {};

  const judge = input.judge?.trim();
  if (judge) {
    const family = input.judge_family ?? familyOf(judge);
    if (!family) {
      throw new Error(
        `judge "${judge}": cannot tell which provider this model belongs to. ` +
          'Set judge_family to "anthropic" or "openai" (--judge-family on the CLI).',
      );
    }
    selection.judge = { [family]: judge };
  } else if (input.judge_family) {
    throw new Error("judge_family only means something together with judge.");
  }

  const models = input.models;
  if (models) {
    if (models.brand) selection.brand = models.brand;
    if (models.drafter) selection.drafter = models.drafter;
    const engines: NonNullable<ModelSelection["engines"]> = {};
    for (const role of ["chatgpt", "claude", "gemini", "perplexity"] as const) {
      const model = models[role];
      if (model) engines[role] = model;
    }
    if (Object.keys(engines).length > 0) selection.engines = engines;
  }

  return selection;
}

/** `skip` -> SkipStages, whichever of the two accepted shapes it arrived in. */
export function normalizeSkip(skip: AuditOptions["skip"]): SkipStages | undefined {
  if (skip === undefined) return undefined;
  if (Array.isArray(skip)) {
    const out: SkipStages = {};
    for (const stage of skip) out[stage] = true;
    return out;
  }
  return skip;
}

/** The one function BOTH the CLI parser and the MCP tools call to turn a
 *  validated AuditOptions (or the VerifyOptions subset) into the normalized,
 *  engine-ready pieces: a resolved ModelSelection, a SkipStages object, and
 *  the validated crawler block. Does NOT touch env vars or saylent.config —
 *  callers layer those in themselves (profiles.ts resolveSkip/
 *  resolveSampling, mergeConfig), exactly as before; this only removes the
 *  duplicated ARGUMENT-SHAPE normalization between the two surfaces. */
export function toRunOptions(
  opts: Pick<
    AuditOptions,
    | "competitors"
    | "engines"
    | "judge"
    | "judge_family"
    | "models"
    | "user_agent"
    | "max_pages"
    | "allow_private"
    | "locale"
    | "skip"
    | "out_dir"
    | "format"
    | "max_usd"
    | "dry_run"
    | "no_brand_model"
  >,
  familyOf: FamilyOfModel,
): ResolvedRunOptions {
  return {
    competitors: opts.competitors ?? [],
    engines: opts.engines as Engine[] | undefined,
    modelSelection: resolveModelSelection(opts, familyOf),
    crawler: {
      userAgent: opts.user_agent ?? null,
      maxPages: opts.max_pages ?? null,
      allowPrivate: Boolean(opts.allow_private),
      locale: opts.locale ?? null,
    },
    skip: normalizeSkip(opts.skip),
    outDir: opts.out_dir,
    format: opts.format,
    maxUsd: opts.max_usd,
    dryRun: Boolean(opts.dry_run),
    noBrandModel: Boolean(opts.no_brand_model),
  };
}
