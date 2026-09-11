// `saylent verify <run.json>` — the same frozen questions, the same engines,
// movement.html + a new run.json.
//
// Split into runVerifyCommandWith(engineMod, configMod, reportMod, argv, io)
// and run(argv), same reason as audit.ts — see run.ts's TESTABILITY NOTE.
import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseArgs } from "node:util";
import type { EngineConfigModule, EngineModule } from "../engine-loader";
import { loadEngine, loadEngineConfig } from "../engine-loader";
import { applyKeysToEnv, hasMinimumKeys, missingKeysError, resolveKeys, promptForKeys, saveKeys, type KeyMap } from "../keys";
import { testProviderKey } from "../key-test";
import { MODEL_FLAG_HELP, MODEL_FLAG_OPTIONS, parseModelFlags } from "../model-flags";
import { cliParseOptions, VERIFY_FIELD_KEYS, type VerifyCliValues } from "../options";
import {
  checkSpendCap,
  confirmRun,
  estimateCostRange,
  formatCostRange,
  formatJudgeModels,
  formatSamplingLine,
  NotATerminalError,
  parseSamplesFlag,
  recordSpend,
} from "../preflight";
import { Progress } from "../progress";
import {
  ALL_FORMATS,
  hasEngineFailures,
  loadBundleFileWith,
  loadReportModules,
  runVerifyToFilesWith,
  type Engine,
  type ReportFormat,
  type ReportModules,
} from "../run";
import { glyph } from "../glyphs";
import { HELP_OPTION, opt, options } from "../help";

const HELP = `saylent verify <run.json> [options]

Re-runs the SAME frozen questions this baseline asked and shows movement.
Refuses when the current saylent.config questionTemplates would generate a
different template set than the baseline was frozen from (questions.ts
TEMPLATE_SET_VERSION) — re-baseline with a fresh \`saylent audit\` instead of
comparing two different question libraries.

Also refuses when the resolved --samples default (flag/AUDIT_SAMPLES/
saylent.config sampling/profile) differs from what this baseline was frozen
with, unless you pass --samples explicitly — pass the baseline's own count to
proceed with it unchanged, or the new one to knowingly verify at a different
sample count.

Options:
${MODEL_FLAG_HELP}
${options([
  opt(
    "--samples <n>",
    "How many times each scored question is asked (1-5). Frozen",
    "questions already carry their own effective count and are",
    "reused as-is; this only decides whether the mismatch guard",
    "above lets the run proceed.",
  ),
  opt("--yes", 'Skip the "Run it?" confirmation'),
  opt("--max-usd <n>", "Refuse to run if the estimate exceeds this"),
  opt(
    "--format <a,b>",
    "Which files to write: json (run.json), html (movement.html).",
    "md is accepted for parity with `audit` but names no file",
    "here — a verify renders no markdown. Default: json,html.",
  ),
  opt(
    "--skip <a,b>",
    "Accepted for parity with `audit` (drafts,corpus,gates), but",
    "has no effect here: a verify never drafts artifacts, fetches",
    "your site's corpus, or checks site gates — those are audit",
    "-only stages regardless of this flag.",
  ),
  opt(
    "--user-agent, --max-pages, --allow-private, --locale",
    "Accepted for parity with `audit`, but have no effect here:",
    "verify re-asks the SAME frozen questions and never crawls,",
    "fetches your site's corpus, or generates a new question set.",
  ),
  HELP_OPTION,
])}`;

export interface VerifyCommandIo {
  stdinIsTTY: boolean;
  promptKeysIo: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream };
  confirmIo?: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream };
}

const REAL_IO: VerifyCommandIo = {
  stdinIsTTY: Boolean(process.stdin.isTTY),
  promptKeysIo: { input: process.stdin, output: process.stdout },
};

export async function runVerifyCommandWith(
  engineMod: EngineModule,
  configMod: Pick<EngineConfigModule, "loadConfig">,
  reportMod: ReportModules,
  argv: string[],
  io: VerifyCommandIo = REAL_IO,
): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  // VERIFY_FIELD_KEYS (options.ts) is the same
  // subset of the shared AuditOptions schema the MCP `verify` tool's
  // inputSchema is built from (VerifyOptionsSchema), so `saylent verify`'s
  // flags and the MCP tool's arguments can never drift apart. `skip` and
  // `user-agent`/`max-pages`/`allow-private`/`locale` are accepted here for
  // parity with `audit` (see the HELP text above) but have no effect: a
  // verify never crawls, fetches corpus, checks gates, or generates a fresh
  // question set.
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      yes: { type: "boolean", default: false },
      ...cliParseOptions(VERIFY_FIELD_KEYS),
      ...MODEL_FLAG_OPTIONS,
    },
  });
  const { positionals } = parsed;
  // See options.ts's AuditCliValues/VerifyCliValues doc comment: parseArgs
  // can't infer named properties from cliParseOptions()'s dynamically
  // generated (index-signature) options record.
  const values = parsed.values as typeof parsed.values & VerifyCliValues;

  const baselinePath = positionals[0];
  if (!baselinePath) {
    process.stderr.write(`Missing <run.json>.\n\n${HELP}\n`);
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

  let formats: ReportFormat[] | undefined;
  if (values.format !== undefined) {
    const names = values.format.split(",").map((f) => f.trim()).filter(Boolean);
    const bad = names.filter((f) => !(ALL_FORMATS as readonly string[]).includes(f));
    if (bad.length > 0 || names.length === 0) {
      process.stderr.write(
        `\n  --format ${values.format}: expected a comma-separated list of ${ALL_FORMATS.join(", ")}.\n`,
      );
      return 1;
    }
    formats = names as ReportFormat[];
  }

  // `--skip` is parsed only to validate the flag (an unknown
  // stage name still errors, same as `audit`); never threaded into
  // RunAuditInput.skip, since a verify's `!isVerify` guard already skips
  // drafts/corpus/gates unconditionally (see the HELP text above).
  let requestedSkip;
  try {
    requestedSkip = engineMod.resolveSkip({ flag: values.skip, env: process.env.AUDIT_SKIP });
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
  const baseline = loadBundleFileWith(engineMod, baselinePath);

  // TEMPLATE-SET GUARD (questions.ts TEMPLATE_SET_VERSION / config.ts
  // questionTemplates): verify reuses the baseline's FROZEN questions
  // verbatim regardless, but comparing movement under a saylent.config that
  // has since changed the template library would misrepresent what changed
  // — refuse honestly instead of silently running.
  const currentTemplateVersion = engineMod.templateSetVersion(config.questionTemplates);
  if (!engineMod.sameTemplateSet(baseline.run.template_set_version, currentTemplateVersion)) {
    process.stderr.write(
      `\n  Refused   this baseline was frozen from template set v${baseline.run.template_set_version}, ` +
        `but saylent.config questionTemplates now resolves to v${currentTemplateVersion}.\n` +
        "            Re-run `saylent audit` to baseline against the current templates, " +
        "or revert the questionTemplates change and verify again.\n",
    );
    return 1;
  }

  // SAMPLES GUARD (profiles.ts resolveSampling / run-audit.ts freezeSamples):
  // the frozen questions already carry their own effective per-question
  // counts and are reused verbatim regardless — but comparing movement under
  // a sample count that silently drifted (AUDIT_SAMPLES changed, config
  // edited) would misrepresent what changed, same reasoning as the
  // template-set guard above. --samples is the acknowledged escape hatch:
  // pass the baseline's own count to proceed unchanged, or a new one to
  // knowingly verify at a different count.
  let requestedSampling;
  try {
    requestedSampling = engineMod.resolveSampling(baseline.run.profile, {
      flag: samplesFlag,
      env: process.env.AUDIT_SAMPLES,
      config: config.sampling ?? null,
    });
  } catch (e) {
    process.stderr.write(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  const baselineCaps = engineMod.PROFILES[baseline.run.profile];
  const baselineSampling = baseline.run.sampling ?? {
    samples: baselineCaps.scoredSamples,
    tiebreak: baselineCaps.scoredTiebreak,
  };
  if (samplesFlag === undefined && requestedSampling.samples !== baselineSampling.samples) {
    process.stderr.write(
      `\n  Refused   this baseline was frozen with ${baselineSampling.samples}x samples per scored question, ` +
        `but the current default now resolves to ${requestedSampling.samples}x.\n` +
        `            Pass --samples ${baselineSampling.samples} to verify with the baseline's own counts, ` +
        `or --samples ${requestedSampling.samples} to explicitly verify at the new default.\n`,
    );
    return 1;
  }

  const { keys: resolvedKeys } = resolveKeys(cwd);
  let keys: KeyMap = resolvedKeys;
  if (!hasMinimumKeys(keys)) {
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

  // Same precedence as audit: flag > MODEL_* env > saylent.config models >
  // shipped registry default (models.ts).
  const table = engineMod.resolveModelTable({ flags: modelFlags, config: config.models });
  const models = engineMod.modelRegistry(table);
  const roles = engineMod.resolveRoles(engineMod.availableFamilies(), { flags: modelFlags, config: config.models });

  const estimate = estimateCostRange(engineMod, baseline.run.profile, baseline.run.engines as Engine[], {
    sampling: requestedSampling,
    questions: baseline.questions,
  });
  process.stdout.write(`\nSaylent ${glyph("sep")} verify ${glyph("sep")} ${baseline.brand_model.domain}\n\n`);
  process.stdout.write(
    `  same ${baseline.questions.length} frozen questions ${glyph("sep")} same ${baseline.run.engines.length} engines ${glyph("sep")} est. ${formatCostRange(estimate)}\n`,
  );
  process.stdout.write(`  Judge     ${formatJudgeModels(roles)}\n`);
  process.stdout.write(`  Sampling  ${formatSamplingLine(requestedSampling, baseline.run.profile)}\n`);
  if (requestedSkip.drafts || requestedSkip.corpus || requestedSkip.gates) {
    process.stdout.write(
      "  Skip      no effect here — verify never drafts artifacts, fetches corpus, or checks gates\n",
    );
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
  const outDir = path.dirname(path.resolve(baselinePath));
  // A verify writes into a sibling dated directory next to the baseline's own
  // output dir, so re-verifying the same brand never clobbers the baseline.
  const dateDir = path.join(path.dirname(outDir), new Date().toISOString().slice(0, 10));

  const { result, movementHtmlPath, runJsonPath } = await runVerifyToFilesWith(
    engineMod,
    reportMod,
    {
      runId,
      baselinePath,
      keys,
      onStage: progress.onStage,
      onLiveLabel: progress.onLiveLabel,
      models,
      roles,
      sampling: { samples: samplesFlag ?? null, sampling: config.sampling ?? null },
      format: formats,
    },
    dateDir,
  );

  progress.finish(result, {
    reportPath: movementHtmlPath ?? runJsonPath,
    verifyPath: runJsonPath,
    brandDomain: baseline.brand_model.domain,
  });
  if (movementHtmlPath) process.stdout.write(`  Movement  ${movementHtmlPath}\n`);

  if (result.costUsd > 0) recordSpend(result.costUsd);
  if (result.status === "failed") return 1;
  return hasEngineFailures(baseline.run.engines as Engine[], result.answers) ? 2 : 0;
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
  return runVerifyCommandWith(engineMod, configMod, reportMod, argv);
}
