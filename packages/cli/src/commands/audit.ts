// `saylent audit <domain>` — the full audit command.
//
// Split into runAuditCommandWith(engineMod, reportMod, argv, io) (arg parsing +
// preflight + the pipeline call, over INJECTED module objects) and run(argv)
// (the real dynamic-loading wrapper) — see run.ts's TESTABILITY NOTE for why: a
// dynamic import() of the @saylent/engine barrel was measured to hang under
// vitest specifically, so tests call the "With" form with a statically-imported
// engineMod instead.
import { heldBackRivalsLine } from "./questions";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import type { Engine, ProfileName, Question } from "@saylent/engine";
import type { EngineConfigModule, EngineModule } from "../engine-loader";
import { loadEngine, loadEngineConfig } from "../engine-loader";
import {
  applyKeysToEnv,
  hasMinimumKeys,
  missingKeysError,
  PROVIDER_TO_ENGINE,
  PROVIDERS,
  promptForKeys,
  resolveKeys,
  saveKeys,
  type KeyMap,
} from "../keys";
import { testProviderKey } from "../key-test";
import { MODEL_FLAG_HELP, MODEL_FLAG_OPTIONS, parseModelFlags } from "../model-flags";
import {
  AuditOptionsSchema,
  BCP47_PATTERN,
  cliParseOptions,
  type AuditCliValues,
  type AuditOptions as SharedAuditOptions,
} from "../options";
import {
  checkSpendCap,
  confirmRun,
  estimateCostRange,
  formatCostRange,
  formatJudgeMode,
  formatJudgeModels,
  formatSamplingLine,
  formatSkipLine,
  NotATerminalError,
  parseSamplesFlag,
  recordSpend,
} from "../preflight";
import { Progress } from "../progress";
import { formatQuestionLines, previewQuestions, typeCounts } from "../question-preview";
import { loadQuestionSetFile, SCORED_TYPES } from "../questions-file";
import {
  ALL_FORMATS,
  defaultOutDir,
  hasEngineFailures,
  loadReportModules,
  runAuditToFilesWith,
  wantsFormat,
  type ReportFormat,
  type ReportModules,
} from "../run";
import { glyph } from "../glyphs";
import { ENGINE_NAMES, parseEngineList, parseProfileName } from "../validate";
import { HELP_OPTION, opt, options } from "../help";

const HELP = `saylent audit <domain> [options]

Provider names and engine names differ, on purpose: a key belongs to a
provider, a question is asked of an engine.
  openai -> chatgpt   anthropic -> claude   gemini -> gemini   perplexity -> perplexity

Options:
${options([
  opt("--brand <name>", "Brand name (default: the domain)"),
  opt("--competitors <a,b>", "Comma-separated competitor domains/names"),
  opt(
    "--profile <profile>",
    "smoke (default) or full. Overrides AUDIT_PROFILE and",
    "saylent.config profile.",
  ),
  opt(
    "--engines <a,b>",
    `Comma-separated engines: ${ENGINE_NAMES.join(",")}.`,
    "Overrides AUDIT_ENGINES and saylent.config engines.",
    "An unknown name is refused, never dropped.",
  ),
  opt(
    "--questions <file>",
    "A run.json bundle, a questions.json (from",
    "`saylent questions`), or a text file with one",
    `question per line. Only ${SCORED_TYPES.join(" and ")} questions`,
    "count toward the score and the recommended band.",
    'Every other type (including "custom", what an',
    "untagged line becomes) is asked and reported but",
    "never scored, so adding your own questions can",
    "never move your own band.",
  ),
  opt("--out <dir>", "Output directory (default: ./<domain>/<YYYY-MM-DD>/)"),
  opt("--format <a,b>", "md,html,json (default: all three)"),
  opt(
    "--samples <n>",
    "How many times each scored question is asked (1-5).",
    "Overrides AUDIT_SAMPLES and saylent.config sampling.",
    "A tiebreak draw is only taken at n=2, on disagreement;",
    "n=1 never votes; n>=3 majority-votes over every draw.",
  ),
  opt(
    "--skip <a,b>",
    "Skip costly stages: drafts,corpus,gates.",
    "drafts = no drafter LLM calls (fixes list without",
    'artifacts, each marked "not drafted"). corpus = no',
    "cited-page fetches (citation presence unverified).",
    "gates = no site checks (never reported as a pass).",
    "Overrides AUDIT_SKIP and saylent.config skip.",
  ),
])}
${MODEL_FLAG_HELP}
${options([
  opt("--yes", 'Skip the "Run it?" confirmation'),
  opt(
    "--dry-run",
    "Print the plan, the questions it would ask (template",
    "defaults, $0, no crawl) and the cost estimate. Spends",
    "nothing, exits 0.",
  ),
  opt(
    "--no-brand-model",
    "Documented for parity with `saylent questions`:",
    "--dry-run always previews with template defaults",
    "already, so this flag has no further effect here.",
  ),
  opt("--max-usd <n>", "Refuse to run if the high estimate exceeds this"),
  opt(
    "--user-agent <string>",
    "Override the crawler's User-Agent (default:",
    "SaylentAudit/<version> (+docs url), or",
    "saylent.config userAgent). Applies to the whole",
    "run's fetches: crawl, corpus, domain checks.",
  ),
  opt(
    "--max-pages <n>",
    "Cap how many crawled pages feed the brand model and",
    "corpus (1-200; default: the profile's own budget).",
  ),
  opt(
    "--allow-private",
    "Allow the audited site's own host (and its",
    "www/apex sibling) to resolve to a private/internal",
    "address, for a staging server on your own network.",
    "Never on by default; prints a warning.",
  ),
  opt(
    "--locale <bcp47>",
    'Translate the generated question set into this',
    'language once (e.g. "de", "pt-BR"), via the',
    "drafter model. No effect with --questions (a",
    "reused set is never regenerated).",
  ),
  HELP_OPTION,
])}`;

export interface AuditCommandIo {
  stdinIsTTY: boolean;
  promptKeysIo: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream };
  confirmIo?: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream };
}

const REAL_IO: AuditCommandIo = {
  stdinIsTTY: Boolean(process.stdin.isTTY),
  promptKeysIo: { input: process.stdin, output: process.stdout },
};

export async function runAuditCommandWith(
  engineMod: EngineModule,
  configMod: Pick<EngineConfigModule, "loadConfig" | "mergeConfig">,
  reportMod: ReportModules,
  argv: string[],
  io: AuditCommandIo = REAL_IO,
): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  // every flag below except `yes` and the model
  // flags (--judge/--judge-family/--model, model-flags.ts's own
  // MODEL_FLAG_OPTIONS) is generated from options.ts's shared AuditOptions
  // schema, the SAME field catalog the MCP `audit` tool's inputSchema reads,
  // so the two surfaces can never drift apart on what a flag/argument is
  // called or how many of them there are — see parity.test.ts.
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      ...cliParseOptions(Object.keys(AuditOptionsSchema.shape) as (keyof SharedAuditOptions)[]),
      yes: { type: "boolean", default: false },
      ...MODEL_FLAG_OPTIONS,
    },
  });
  const { positionals } = parsed;
  // See options.ts's AuditCliValues doc comment: parseArgs can't infer named
  // properties from cliParseOptions()'s dynamically generated (index-
  // signature) options record, so this restores the static field names —
  // the actual accepted flags are exactly what cliParseOptions() generated.
  const values = parsed.values as typeof parsed.values & AuditCliValues;

  const domain = positionals[0];
  if (!domain) {
    process.stderr.write(`Missing <domain>.\n\n${HELP}\n`);
    return 1;
  }

  let modelFlags;
  try {
    modelFlags = parseModelFlags(values, engineMod.familyOfModel);
  } catch (e) {
    process.stderr.write(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  let samplesFlag: number | undefined;
  try {
    samplesFlag = parseSamplesFlag(values.samples);
  } catch (e) {
    process.stderr.write(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  const cwd = process.cwd();
  // A saylent.config with a bad value is a user mistake, not a crash: the
  // schema's own message already names the key and the accepted values, so it
  // is printed like every other refusal (2-space indent, exit 1, no stack).
  let config;
  try {
    ({ config } = await configMod.loadConfig(cwd));
  } catch (e) {
    process.stderr.write(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  // --skip flag > AUDIT_SKIP env > saylent.config
  // skip > none. Resolved ONCE, printed in the preflight, and threaded into
  // the pipeline so the run actually skips what the preflight promised.
  let resolvedSkip;
  try {
    resolvedSkip = engineMod.resolveSkip({
      flag: values.skip,
      env: process.env.AUDIT_SKIP,
      config: config.skip ?? null,
    });
  } catch (e) {
    process.stderr.write(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  // --profile / --engines: validated by hand (validate.ts) at EVERY layer that
  // can supply them — flag, env, saylent.config — before anything downstream
  // casts them into the engine's own types. A bad profile used to reach
  // PROFILES[profile] as `undefined` and crash with a raw TypeError; a bad
  // engine name used to be filtered away silently and the operator paid for a
  // run they did not ask for.
  let flagProfile: ProfileName | undefined;
  let envProfile: ProfileName | undefined;
  let configProfile: ProfileName | undefined;
  let flagEngines: Engine[] | undefined;
  let envEngines: Engine[] | undefined;
  let configEngines: Engine[] | undefined;
  const profileNames = Object.keys(engineMod.PROFILES) as ProfileName[];
  try {
    flagProfile = parseProfileName(values.profile, profileNames, "flag");
    envProfile = parseProfileName(process.env.AUDIT_PROFILE, profileNames, "env");
    configProfile = parseProfileName(config.profile, profileNames, "config");
    flagEngines = parseEngineList(values.engines, "flag");
    envEngines = parseEngineList(process.env.AUDIT_ENGINES?.trim() || undefined, "env");
    configEngines = parseEngineList(config.engines, "config");
  } catch (e) {
    process.stderr.write(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  // config < env < flags, the repo-wide precedence rule (config.ts mergeConfig).
  const merged = configMod.mergeConfig(
    config,
    { profile: configProfile, engines: configEngines },
    { profile: envProfile, engines: envEngines },
    {
      profile: flagProfile,
      engines: flagEngines,
      competitors: values.competitors?.split(",").map((c) => c.trim()),
    },
  );

  const profile: ProfileName = merged.profile ?? "smoke";
  const competitors = merged.competitors ?? [];
  const brandName = values.brand ?? domain;
  const outDir = values.out ?? defaultOutDir(domain);
  const dryRun = Boolean(values["dry-run"]);

  // --format md,html,json -> which FILES this run writes. Unset = all three.
  let formats: ReportFormat[] | undefined;
  if (values.format !== undefined) {
    const names = values.format.split(",").map((f) => f.trim()).filter(Boolean);
    const bad = names.filter((f) => !(ALL_FORMATS as readonly string[]).includes(f));
    if (bad.length > 0 || names.length === 0) {
      process.stderr.write(`\n  --format ${values.format}: expected a comma-separated list of ${ALL_FORMATS.join(", ")}.\n`);
      return 1;
    }
    formats = names as ReportFormat[];
  }

  // --user-agent/--max-pages/--allow-private/--locale: flag >
  // saylent.config, never on by default. See run.ts CrawlerOptions.
  let maxPages: number | null = null;
  if (values["max-pages"] !== undefined) {
    const n = Number(values["max-pages"]);
    if (!Number.isInteger(n) || n < 1 || n > 200) {
      process.stderr.write(`\n  --max-pages ${values["max-pages"]}: expected a whole number 1-200.\n`);
      return 1;
    }
    maxPages = n;
  } else if (config.maxPages !== undefined) {
    maxPages = config.maxPages;
  }
  const userAgent = values["user-agent"] ?? config.userAgent ?? null;
  const allowPrivate = Boolean(values["allow-private"]) || Boolean(config.allowPrivate);
  const locale = values.locale ?? config.locale ?? null;
  if (locale && !BCP47_PATTERN.test(locale)) {
    process.stderr.write(`\n  --locale ${locale}: expected a BCP47 tag, e.g. "de" or "pt-BR".\n`);
    return 1;
  }

  // Samples feature: --samples flag > AUDIT_SAMPLES env > saylent.config
  // sampling > the profile default. Resolved ONCE, printed in the preflight,
  // and threaded into the pipeline so the run actually uses what it promised.
  let resolvedSampling;
  try {
    resolvedSampling = engineMod.resolveSampling(profile, {
      flag: samplesFlag,
      env: process.env.AUDIT_SAMPLES,
      config: config.sampling ?? null,
    });
  } catch (e) {
    process.stderr.write(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  const { keys: resolvedKeys } = resolveKeys(cwd);
  let keys: KeyMap = resolvedKeys;

  if (!hasMinimumKeys(keys) && !dryRun) {
    if (io.stdinIsTTY) {
      const { keys: entered } = await promptForKeys(io.promptKeysIo, (provider, key) =>
        testProviderKey(provider, key).then((r) => r.ok),
      );
      keys = { ...keys, ...entered };
      if (Object.keys(entered).length > 0) saveKeys(resolvedKeys, entered);
    } else {
      process.stderr.write(`${missingKeysError().message}\n`);
      return 1;
    }
  }

  applyKeysToEnv(keys);

  const requestedEngines: Engine[] = merged.engines ?? PROVIDERS.map((p) => PROVIDER_TO_ENGINE[p.id]);
  const availableEngines = requestedEngines.filter((e) => {
    const provider = PROVIDERS.find((p) => PROVIDER_TO_ENGINE[p.id] === e);
    return provider ? Boolean(keys[provider.id]) : false;
  });
  if (availableEngines.length === 0 && !dryRun) {
    process.stderr.write("No engine has a usable key. Run `saylent keys` to add one.\n");
    return 1;
  }

  // The resolved model table + judgment roles for this run: CLI flag >
  // MODEL_* env > saylent.config `models` > shipped registry default
  // (models.ts). Computed once, printed in the preflight, and threaded into
  // the pipeline so the run actually uses what the preflight promised.
  const table = engineMod.resolveModelTable({ flags: modelFlags, config: config.models });
  const models = engineMod.modelRegistry(table);
  const roles = engineMod.resolveRoles(engineMod.availableFamilies(), { flags: modelFlags, config: config.models });

  // Loaded ahead of the estimate (not just before dry-run) so a --questions
  // file's row count/removals/additions are reflected in the printed estimate,
  // not only in the frozen set the run actually asks.
  const loadedQuestionFile = values.questions ? loadQuestionSetFile(values.questions) : null;
  const questionSet: { questions: Question[]; version?: number; engines?: string[] } | null = loadedQuestionFile
    ? {
        questions: loadedQuestionFile.questions as Question[],
        version: loadedQuestionFile.version,
        engines: loadedQuestionFile.engines,
      }
    : null;

  const estimate = estimateCostRange(
    engineMod,
    profile,
    availableEngines.length > 0 ? availableEngines : (["chatgpt", "claude"] as Engine[]),
    { sampling: resolvedSampling, questions: loadedQuestionFile?.questions, skip: resolvedSkip },
  );
  const caps = engineMod.PROFILES[profile];

  process.stdout.write("\n");
  process.stdout.write(`Saylent ${glyph("sep")} audit ${glyph("sep")} ${domain}\n\n`);
  const keyLine = PROVIDERS.map((p) => `${p.label} ${keys[p.id] ? glyph("check") : glyph("ndash")}`).join("   ");
  process.stdout.write(`  Keys      ${keyLine}\n`);
  const missingHint = PROVIDERS.filter((p) => !p.required && !keys[p.id])
    .map((p) => `${p.envVar}`)
    .join(" / ");
  // Zero usable engines is only reachable on a --dry-run (a real run already
  // refused above). Say WHY the list is empty rather than printing a bare
  // "(none)" the reader has to decode.
  const engineLine = availableEngines.join(", ") || "(none: add a key)";
  process.stdout.write(
    `  Engines   ${engineLine}${availableEngines.length > 0 && missingHint ? `   (add ${missingHint} for ${PROVIDERS.length} engines)` : ""}\n`,
  );
  // SINGLE-PROVIDER MODE + model overrides: say which family judges, and with
  // which exact model(s), before a cent is spent.
  process.stdout.write(`  Judge     ${formatJudgeMode(keys)}  ${glyph("sep")}  ${formatJudgeModels(roles)}\n`);
  // With no key there is no engine, and with no engine there is nothing to
  // price: the fixed brand/judge/drafter overhead alone used to print
  // "est. $0.40-$0.60" next to "0 engines", which is a number that cannot be
  // true. Say what is missing instead of quoting a made-up range.
  const estimateText =
    availableEngines.length > 0
      ? `est. ${formatCostRange(estimate)} of your credits`
      : "est. add a key to price this run";
  process.stdout.write(
    `  Profile   ${profile} ${glyph("sep")} ${caps.questions} questions ${glyph("sep")} ${availableEngines.length} engines ${glyph("sep")} ${estimateText}\n`,
  );
  const outputFiles = [
    wantsFormat(formats, "json") ? "run.json" : null,
    wantsFormat(formats, "html") ? "report.html" : null,
    wantsFormat(formats, "md") ? "report.md" : null,
  ].filter(Boolean);
  process.stdout.write(`  Output    ${outDir}/  (${outputFiles.join(` ${glyph("sep")} `)})\n`);
  process.stdout.write(`  Sampling  ${formatSamplingLine(resolvedSampling, profile)}\n`);
  const skipLine = formatSkipLine(resolvedSkip);
  if (skipLine) process.stdout.write(`  ${skipLine}\n`);
  if (userAgent) process.stdout.write(`  User-agent ${userAgent}\n`);
  if (maxPages) {
    process.stdout.write(
      `  Max pages ${maxPages}  (caps what feeds the brand model + corpus; the crawl's own requests still use the profile's page budget)\n`,
    );
  }
  if (locale && !questionSet) {
    // A fresh question set only exists when nothing was reused via
    // --questions; the translation cost is one drafter call regardless of
    // question count (ROLE_COST_CENTS.drafter in run-audit.ts).
    process.stdout.write(`  Locale    ${locale}  (translates the question set once, ~$0.02-0.05 more, via the drafter model)\n`);
  } else if (locale) {
    process.stdout.write(`  Locale    ${locale}  (no effect: --questions reuses a set verbatim, never regenerated)\n`);
  }
  if (allowPrivate) {
    process.stdout.write(
      `  Warning   --allow-private is on: ${domain} (and its www/apex sibling) may resolve to a private/internal ` +
        "address for this run. Only use this for a site you trust on your own network.\n",
    );
  }

  if (dryRun) {
    // --dry-run is a $0/no-network preview by definition: the printed
    // question set always comes from the template defaults (never a real
    // crawl or brand-model call), exactly like `--no-brand-model` on
    // `saylent questions`. A --questions file, when given, is reused
    // verbatim instead (it is already free — it was written to disk earlier).
    const preview = loadedQuestionFile
      ? {
          questions: loadedQuestionFile.questions,
          version: loadedQuestionFile.templateVersion ?? engineMod.templateSetVersion(config.questionTemplates),
        }
      : await previewQuestions(engineMod, {
          domain,
          brandName,
          competitors,
          useBrandModel: false,
          questionTemplates: config.questionTemplates,
        });
    const source = loadedQuestionFile ? "from --questions" : "template defaults";
    // The frozen set and the set THIS profile asks are two different numbers,
    // and the dry run used to print both four lines apart with no explanation
    // ("6 questions" in the Profile line, then a list of 23). The selection is
    // taken from the SAME function the run itself uses (run-audit's
    // selectForProfile, which honours user-authored --questions rows), so the
    // marked rows are exactly the rows that would be asked.
    const asked = engineMod.selectForProfile(preview.questions as Question[], profile);
    const askedQids = new Set(asked.map((q) => q.qid));
    const selectionText =
      askedQids.size >= preview.questions.length
        ? `${profile} asks all ${preview.questions.length}`
        : `${profile} asks ${askedQids.size} (marked ${glyph("dot")})`;
    process.stdout.write(
      `\n  Questions ${preview.questions.length} frozen ${glyph("sep")} ${selectionText} ${glyph("sep")} ${source}, $0 ${glyph("sep")} set v${preview.version} ${glyph("sep")} ${typeCounts(preview.questions)}\n` +
        heldBackRivalsLine(preview.questions) +
        "\n",
    );
    process.stdout.write(
      `${formatQuestionLines(preview.questions, SCORED_TYPES, askedQids.size >= preview.questions.length ? undefined : askedQids)}\n`,
    );
    process.stdout.write("\n  Dry run. Nothing was sent to any provider. $0 spent.\n");
    return 0;
  }

  const spendCheck = checkSpendCap(estimate.highUsd, {
    maxUsd: values["max-usd"] ? Number(values["max-usd"]) : undefined,
  });
  if (!spendCheck.ok) {
    process.stderr.write(`\n  ${spendCheck.reason}\n`);
    return 1;
  }

  if (!values.yes) {
    process.stdout.write("\n");
    let ok: boolean;
    try {
      ok = await confirmRun(io.confirmIo);
    } catch (e) {
      // No terminal to ask, and no --yes: refuse rather than spend on an
      // answer nobody gave (preflight.ts confirmRun).
      if (e instanceof NotATerminalError) {
        process.stderr.write(`\n  ${e.message}\n`);
        return 1;
      }
      throw e;
    }
    if (!ok) {
      process.stdout.write("Aborted. Nothing was sent to any provider.\n");
      return 0;
    }
  }

  process.stdout.write("\n");
  const progress = new Progress();

  const runId = randomUUID();
  const { result, reportHtmlPath, reportMdPath, runJsonPath } = await runAuditToFilesWith(
    engineMod,
    reportMod,
    {
      runId,
      brandName,
      domain,
      competitors,
      profile,
      engines: availableEngines,
      keys,
      questionSet,
      onStage: progress.onStage,
      onLiveLabel: progress.onLiveLabel,
      models,
      roles,
      sampling: { samples: samplesFlag ?? null, sampling: config.sampling ?? null },
      config: {
        questionTemplates: config.questionTemplates ?? null,
        extraBots: config.extraBots ?? null,
        thresholds: config.thresholds ?? null,
      },
      crawler: { userAgent, maxPages, allowPrivate, locale },
      skip:
        resolvedSkip.drafts || resolvedSkip.corpus || resolvedSkip.gates
          ? { drafts: resolvedSkip.drafts, corpus: resolvedSkip.corpus, gates: resolvedSkip.gates }
          : null,
      format: formats,
    },
    outDir,
  );

  progress.finish(result, {
    // whichever report file was actually written; the bundle is the last
    // resort when --format asked for json alone.
    reportPath: reportHtmlPath ?? reportMdPath ?? runJsonPath,
    verifyPath: runJsonPath,
    brandDomain: domain,
  });

  if (result.costUsd > 0) recordSpend(result.costUsd);

  if (result.status === "failed") return 1;
  return hasEngineFailures(availableEngines, result.answers) ? 2 : 0;
}

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const [engineMod, configMod, reportMod] = await Promise.all([
    loadEngine(),
    loadEngineConfig(),
    loadReportModules(),
  ]);
  return runAuditCommandWith(engineMod, configMod, reportMod, argv);
}
