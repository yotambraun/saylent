// The four MCP tools, as plain async functions over
// injected module objects (the "*With" convention run.ts documents: tests
// import @saylent/engine / @saylent/report STATICALLY and hand them in;
// server.ts hands in the lazily loaded real ones).
//
// TWO RULES THIS FILE EXISTS TO KEEP:
//   1. NO PIPELINE LOGIC IS DUPLICATED. audit/verify call run.ts's
//      runAuditToFilesWith / runVerifyToFilesWith, gate_check calls
//      gate-check.ts's runGateCheckWith (with an out() sink instead of
//      stdout), read_report calls the same bundle reader + Brief composer the
//      report does. Keys, the cost estimate and the spend cap come from
//      keys.ts / preflight.ts unchanged, so an MCP run refuses in exactly the
//      places and with exactly the words the CLI refuses.
//   2. NOTHING HERE MAY WRITE TO STDOUT. Under `saylent mcp` stdout IS the
//      JSON-RPC channel — one stray line corrupts the stream. That is why the
//      CLI *command* wrappers (audit.ts/verify.ts, which print a preflight
//      table and a Progress narration) are deliberately NOT reused; their
//      pure halves are. Progress goes out as MCP log notifications through
//      `deps.log`.
//
// KEYS ARE NEVER TOOL ARGUMENTS. An agent cannot pass a
// provider key to this server: keys come from the environment, a .env in the
// server's working directory, or ~/.saylent/config.json, resolved by the same
// keys.ts the CLI uses. There is no key parameter on any tool.
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Engine, Fetcher, ProfileName, Question, RunResult, RunStage } from "@saylent/engine";
import type { RunBundleV1 } from "@saylent/engine/bundle";
import type { Brief } from "@saylent/report/brief";
import type { EngineConfigModule, EngineModule, GateCheckEngine } from "../engine-loader";
import { runGateCheckWith } from "../commands/gate-check";
import {
  applyKeysToEnv,
  hasMinimumKeys,
  missingKeysError,
  PROVIDER_TO_ENGINE,
  PROVIDERS,
  resolveKeys,
} from "../keys";
import {
  type AuditOptions as SharedAuditOptions,
  type VerifyOptions as SharedVerifyOptions,
  normalizeSkip,
  resolveModelSelection,
} from "../options";
import { checkSpendCap, estimateCostRange, recordSpend } from "../preflight";
import { previewQuestions } from "../question-preview";
import { loadQuestionSetFile, SCORED_TYPES, type QuestionSetFile } from "../questions-file";
import {
  defaultOutDir,
  loadBundleFileWith,
  runAuditToFilesWith,
  runVerifyToFilesWith,
  type PipelineDeps,
  type ReportModules,
} from "../run";
import { briefFromBundle, briefSection, sectionNames, type BuildBriefFn, type ReportDataFromBundleFn } from "./summary";

// ---------------------------------------------------------------------------
// injected dependencies
// ---------------------------------------------------------------------------

/** Everything a paid run needs: the engine, saylent.config, the renderers and
 *  the Brief composer. */
export interface RunDeps {
  engineMod: EngineModule;
  configMod: Pick<EngineConfigModule, "loadConfig" | "mergeConfig">;
  reportMod: ReportModules;
  reportDataFromBundle: ReportDataFromBundleFn;
  buildBrief: BuildBriefFn;
}

/** What `read_report` needs — deliberately less than RunDeps so a $0 read
 *  never pays for llm.ts's openai/@anthropic-ai/sdk imports. */
export interface BundleDeps {
  readBundle: EngineModule["readBundle"];
  reportDataFromBundle: ReportDataFromBundleFn;
  buildBrief: BuildBriefFn;
}

export interface McpToolDeps {
  /** lazy: only resolved when a tool that spends is actually called */
  run: () => Promise<RunDeps>;
  /** lazy: the lean crawl + domain-check modules gate_check needs */
  gate: () => Promise<GateCheckEngine>;
  /** lazy: bundle reader + Brief composer for read_report */
  bundle: () => Promise<BundleDeps>;
  /** where saylent.config / .env / relative out dirs resolve from */
  cwd?: string;
  /** progress -> MCP log notifications (no-op in tests) */
  log?: (message: string) => void;
  /** test seam: a fake ask/llm/fetcher pipeline (never set in production) */
  pipeline?: PipelineDeps;
  /** test seam: gate_check's fetcher (defaults to the real safeFetch) */
  fetcher?: Fetcher;
}

// ---------------------------------------------------------------------------
// results
// ---------------------------------------------------------------------------

export interface RunToolResult {
  /** the CLI's own Verdict line, verbatim */
  verdict: string;
  /** the CLI's own Band line, verbatim */
  band: string;
  /** the Brief blocks, the same ones report.html and report.md render */
  summary_blocks: Brief;
  report_paths: Record<string, string>;
  cost_usd: number;
}

export interface GateCheckResult {
  domain: string;
  /** PASS / WARN / FAIL, the same word the CLI prints */
  result: string;
  /** the CLI's exit code: 0 clean, 1 a failing check */
  exit_code: number;
  /** the full block the CLI prints, verbatim */
  report: string;
  cost_usd: 0;
}

export interface ReadReportResult {
  bundle_path: string;
  brand: string;
  domain: string;
  profile: string;
  measured_at: string | null;
  /** the whole Brief, or one named section when `section` was given */
  summary_blocks: Brief | unknown;
  sections: string[];
  cost_usd: 0;
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

/** The Verdict/Band pair progress.ts prints at the end of a run, built from
 *  the same RunResult fields with the same honest denominator (the count of
 *  answers actually judged, never the static question count). */
export function verdictAndBand(result: RunResult): { verdict: string; band: string } {
  const overall = result.scores?.overall;
  if (!overall) return { verdict: "not scored (run did not complete)", band: "not scored" };
  const total = overall.answered;
  return {
    verdict: `Mentioned in ${overall.mentioned} of ${total} answers. Recommended in ${overall.recommended} of ${total}.`,
    band: overall.rec_rate === null ? "not scored" : `recommended ${overall.recommended} of ${total}`,
  };
}

/** Only the files this run actually wrote: a format the caller did not ask
 *  for comes back as null from the pipeline and must never appear here as a
 *  path to a file that does not exist. */
function writtenPaths(paths: Record<string, string | null>): Record<string, string> {
  return Object.fromEntries(Object.entries(paths).filter(([, v]) => v !== null)) as Record<string, string>;
}

/** An agent naturally holds the run DIRECTORY (that is what the audit tool
 *  hands back), so a directory is accepted wherever a bundle path is asked
 *  for and resolved to the run.json inside it. */
export function resolveBundlePath(bundlePath: string): string {
  const resolved = path.resolve(bundlePath);
  if (existsSync(resolved) && statSync(resolved).isDirectory()) return path.join(resolved, "run.json");
  return resolved;
}

// ---------------------------------------------------------------------------
// The MCP-only guards.
//
// The CLI and the MCP server share every pipeline path, but they do NOT share
// a threat model. A CLI flag is typed by the person who owns the machine; an
// MCP tool argument is chosen by a model, from text it read somewhere. These
// three guards are therefore MCP-only, each with a one-variable escape hatch
// for the operator who genuinely wants the CLI's latitude.
// ---------------------------------------------------------------------------

/** `allow_private` turns off the SSRF private-IP guard for the audited
 *  host. An agent must not be able to point Saylent at 169.254.169.254 or an
 *  intranet box just by setting a boolean. */
export function assertAllowPrivateAllowed(args: { allow_private?: boolean }): void {
  if (!args.allow_private) return;
  if (process.env.SAYLENT_MCP_ALLOW_PRIVATE === "1") return;
  throw new Error(
    "Refused: allow_private turns off the private-network (SSRF) guard, and the MCP server does not honor it by default. " +
      "If you really mean to audit a host on this machine's private network, restart the server with SAYLENT_MCP_ALLOW_PRIVATE=1 in its environment, " +
      "or run `saylent audit --allow-private` in a terminal instead.",
  );
}

/** `saylent.config.{js,mjs,ts}` EXECUTES when loaded. An agent picks
 *  the directory an MCP server runs in, so the MCP path reads
 *  `saylent.config.json` only and says so when it skips one. */
export async function loadConfigForMcp(
  configMod: Pick<RunDeps["configMod"], "loadConfig">,
  cwd: string,
  log?: (m: string) => void,
): Promise<Awaited<ReturnType<RunDeps["configMod"]["loadConfig"]>>> {
  const allowExecutable = process.env.SAYLENT_MCP_ALLOW_EXEC_CONFIG === "1";
  return configMod.loadConfig(cwd, {
    allowExecutable,
    onSkipped: (file) =>
      log?.(
        `ignored ${file}: an executable saylent config runs code when it loads, and the MCP server reads saylent.config.json only. Set SAYLENT_MCP_ALLOW_EXEC_CONFIG=1 to allow it.`,
      ),
  });
}

/** realpath the deepest EXISTING ancestor of `target` and re-attach the rest,
 *  so a symlinked out_dir (or a symlinked ancestor that does not exist yet)
 *  cannot smuggle the write outside the workspace. */
function realpathThroughMissing(target: string): string {
  let cur = path.resolve(target);
  const rest: string[] = [];
  for (;;) {
    if (existsSync(cur)) return path.join(realpathSync(cur), ...rest.reverse());
    const parent = path.dirname(cur);
    if (parent === cur) return path.join(cur, ...rest.reverse());
    rest.push(path.basename(cur));
    cur = parent;
  }
}

function isInside(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

/** `out_dir` is a raw filesystem path an agent chose. Resolve it
 *  against the server's own cwd (which is also where saylent.config and .env
 *  resolve from) and refuse anything that lands outside, symlinks included. */
export function resolveMcpOutDir(cwd: string, requested: string | undefined, fallback: string): string {
  const base = path.resolve(cwd);
  const outDir = path.resolve(base, requested ?? fallback);
  if (process.env.SAYLENT_MCP_ALLOW_ANY_OUT_DIR === "1") return outDir;
  if (!isInside(realpathThroughMissing(base), realpathThroughMissing(outDir))) {
    throw new Error(
      `Refused: out_dir "${requested ?? fallback}" resolves outside this server's working directory (${base}). ` +
        "Pass a path inside it, or restart the server with SAYLENT_MCP_ALLOW_ANY_OUT_DIR=1 to write anywhere.",
    );
  }
  return outDir;
}

function stageLogger(log: ((m: string) => void) | undefined): {
  onStage?: (stage: RunStage, detail: string) => void;
  onLiveLabel?: (label: string) => void;
} {
  if (!log) return {};
  return {
    onStage: (stage, detail) => log(detail ? `${stage}: ${detail}` : stage),
    onLiveLabel: (label) => log(label),
  };
}

// ---------------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------------

// AuditToolArgs/VerifyToolArgs are the shared
// options.ts AuditOptions/VerifyOptions zod-inferred types VERBATIM, so this
// tool's argument set and `saylent audit`/`saylent verify`'s flag set can
// never drift apart — see parity.test.ts.
export type AuditToolArgs = SharedAuditOptions;
export type VerifyToolArgs = SharedVerifyOptions;

export interface DryRunResult {
  dry_run: true;
  domain: string;
  brand: string;
  profile: ProfileName;
  engines: Engine[];
  question_set: {
    version: number | string;
    source: "questions_file/questions" | "template defaults";
    count: number;
    questions: { qid: string; qtype: string; text: string; scored: boolean }[];
  };
  estimate_usd: { low: number; high: number };
  cost_usd: 0;
}

/** `questions_file` (a path, same three shapes `--questions` accepts) or
 *  inline `questions` rows ({id?, type?, text, samples?}) — MCP-only, since a
 *  tool argument can carry structured JSON a CLI flag cannot. Inline rows go
 *  through the SAME loadQuestionSetFile() the CLI's `--questions <file>`
 *  uses (a temp file, cleaned up immediately after) rather than a second,
 *  parallel row-parsing path, so validation/ids/types can never diverge. */
function loadQuestionsArg(args: Pick<AuditToolArgs, "questions_file" | "questions">): QuestionSetFile | null {
  if (args.questions_file) return loadQuestionSetFile(args.questions_file);
  if (args.questions && args.questions.length > 0) {
    const dir = mkdtempSync(path.join(tmpdir(), "saylent-mcp-questions-"));
    try {
      const file = path.join(dir, "questions.json");
      writeFileSync(file, JSON.stringify(args.questions), "utf8");
      return loadQuestionSetFile(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return null;
}

function skipToCsv(skip: ReturnType<typeof normalizeSkip>): string | undefined {
  if (!skip) return undefined;
  const on = (["drafts", "corpus", "gates"] as const).filter((k) => skip[k]);
  return on.length > 0 ? on.join(",") : undefined;
}

export async function auditTool(deps: McpToolDeps, args: AuditToolArgs): Promise<RunToolResult | DryRunResult> {
  const cwd = deps.cwd ?? process.cwd();
  assertAllowPrivateAllowed(args);
  const { engineMod, configMod, reportMod, reportDataFromBundle, buildBrief } = await deps.run();

  const { config } = await loadConfigForMcp(configMod, cwd, deps.log);
  const merged = configMod.mergeConfig(config, {
    profile: args.profile,
    engines: args.engines as Engine[] | undefined,
    competitors: args.competitors,
  });
  const profile: ProfileName = merged.profile ?? "smoke";
  const competitors = merged.competitors ?? [];
  const brandName = args.brand ?? args.domain;
  const outDir = resolveMcpOutDir(cwd, args.out_dir, defaultOutDir(args.domain));

  // Same resolution ladder as `saylent audit --samples` (flag > AUDIT_SAMPLES
  // > saylent.config sampling > profile default).
  const resolvedSampling = engineMod.resolveSampling(profile, {
    flag: args.samples,
    env: process.env.AUDIT_SAMPLES,
    config: config.sampling ?? null,
  });

  // Same flag > AUDIT_SKIP env > saylent.config
  // skip precedence `saylent audit --skip` resolves; `args.skip` stands in for
  // the flag, normalized to the SkipStages object shape regardless of which
  // of the two accepted shapes ({drafts,corpus,gates} or a list) it arrived in.
  const resolvedSkip = engineMod.resolveSkip({
    flag: skipToCsv(normalizeSkip(args.skip)),
    env: process.env.AUDIT_SKIP,
    config: config.skip ?? null,
  });

  const loadedQuestionFile = loadQuestionsArg(args);
  const requestedEngines: Engine[] = merged.engines ?? PROVIDERS.map((p) => PROVIDER_TO_ENGINE[p.id]);

  if (args.dry_run) {
    // $0, no keys required, no network beyond none — same guarantee as
    // `saylent audit --dry-run`: the printed set is either the reused
    // questions_file/questions, or the template defaults, never a real crawl
    // or brand-model call.
    const preview = loadedQuestionFile
      ? {
          questions: loadedQuestionFile.questions,
          version: loadedQuestionFile.templateVersion ?? engineMod.templateSetVersion(config.questionTemplates),
        }
      : await previewQuestions(engineMod, {
          domain: args.domain,
          brandName,
          competitors,
          useBrandModel: false,
          questionTemplates: config.questionTemplates,
        });
    const estimate = estimateCostRange(
      engineMod,
      profile,
      requestedEngines.length > 0 ? requestedEngines : (["chatgpt", "claude"] as Engine[]),
      { sampling: resolvedSampling, questions: loadedQuestionFile?.questions, skip: resolvedSkip },
    );
    return {
      dry_run: true,
      domain: args.domain,
      brand: brandName,
      profile,
      engines: requestedEngines,
      question_set: {
        version: preview.version,
        source: loadedQuestionFile ? "questions_file/questions" : "template defaults",
        count: preview.questions.length,
        questions: preview.questions.map((q) => ({
          qid: q.qid,
          qtype: q.qtype,
          text: q.text,
          scored: (SCORED_TYPES as readonly string[]).includes(q.qtype),
        })),
      },
      estimate_usd: { low: estimate.lowUsd, high: estimate.highUsd },
      cost_usd: 0,
    };
  }

  // KEYS: environment / .env / ~/.saylent/config.json only — never an argument.
  const { keys } = resolveKeys(cwd);
  if (!hasMinimumKeys(keys)) throw missingKeysError();
  applyKeysToEnv(keys);

  const engines = requestedEngines.filter((e) => {
    const provider = PROVIDERS.find((p) => PROVIDER_TO_ENGINE[p.id] === e);
    return provider ? Boolean(keys[provider.id]) : false;
  });
  if (engines.length === 0) throw new Error("No engine has a usable key. Run `saylent keys` in a terminal to add one.");

  const modelSelection = resolveModelSelection(args, engineMod.familyOfModel);
  const table = engineMod.resolveModelTable({ flags: modelSelection, config: config.models });
  const models = engineMod.modelRegistry(table);
  const roles = engineMod.resolveRoles(engineMod.availableFamilies(), { flags: modelSelection, config: config.models });

  const questionSet = loadedQuestionFile
    ? {
        questions: loadedQuestionFile.questions as Question[],
        version: loadedQuestionFile.version,
        engines: loadedQuestionFile.engines,
      }
    : null;

  const estimate = estimateCostRange(engineMod, profile, engines, {
    sampling: resolvedSampling,
    questions: loadedQuestionFile?.questions,
    skip: resolvedSkip,
  });
  const spendCheck = checkSpendCap(estimate.highUsd, { maxUsd: args.max_usd });
  if (!spendCheck.ok) throw new Error(spendCheck.reason);

  deps.log?.(
    `audit ${args.domain} · ${profile} · ${engines.join(", ")} · est. $${estimate.lowUsd.toFixed(2)}-${estimate.highUsd.toFixed(2)}`,
  );

  const { result, bundle, runJsonPath, reportHtmlPath, reportMdPath } = await runAuditToFilesWith(
    engineMod,
    reportMod,
    {
      runId: randomUUID(),
      brandName,
      domain: args.domain,
      competitors,
      profile,
      engines,
      keys,
      questionSet,
      models,
      roles,
      sampling: { samples: args.samples ?? null, sampling: config.sampling ?? null },
      config: {
        questionTemplates: config.questionTemplates ?? null,
        extraBots: config.extraBots ?? null,
        thresholds: config.thresholds ?? null,
      },
      crawler: {
        userAgent: args.user_agent ?? null,
        maxPages: args.max_pages ?? null,
        allowPrivate: Boolean(args.allow_private),
        locale: args.locale ?? null,
      },
      skip:
        resolvedSkip.drafts || resolvedSkip.corpus || resolvedSkip.gates
          ? { drafts: resolvedSkip.drafts, corpus: resolvedSkip.corpus, gates: resolvedSkip.gates }
          : null,
      // `format` writes only the files the agent asked for, exactly as
      // `saylent audit --format` does.
      format: args.format,
      deps: deps.pipeline,
      ...stageLogger(deps.log),
    },
    outDir,
  );

  if (result.costUsd > 0) recordSpend(result.costUsd);

  const { verdict, band } = verdictAndBand(result);
  return {
    verdict,
    band,
    summary_blocks: briefFromBundle(bundle, reportDataFromBundle, buildBrief),
    report_paths: writtenPaths({ run_json: runJsonPath, report_html: reportHtmlPath, report_md: reportMdPath }),
    cost_usd: Math.round(result.costUsd * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

export async function verifyTool(deps: McpToolDeps, args: VerifyToolArgs): Promise<RunToolResult> {
  const cwd = deps.cwd ?? process.cwd();
  assertAllowPrivateAllowed(args);
  const { engineMod, configMod, reportMod, reportDataFromBundle, buildBrief } = await deps.run();
  const { config } = await loadConfigForMcp(configMod, cwd, deps.log);

  const baselinePath = resolveBundlePath(args.bundle_path);
  const baseline = loadBundleFileWith(engineMod, baselinePath);

  // The same two honesty guards `saylent verify` refuses on: a template set
  // that has since changed, and a sample count that silently drifted.
  const currentTemplateVersion = engineMod.templateSetVersion(config.questionTemplates);
  if (!engineMod.sameTemplateSet(baseline.run.template_set_version, currentTemplateVersion)) {
    throw new Error(
      `Refused: this baseline was frozen from template set v${baseline.run.template_set_version}, but saylent.config questionTemplates now resolves to v${currentTemplateVersion}. Run a fresh audit to re-baseline, or revert the questionTemplates change.`,
    );
  }
  const requestedSampling = engineMod.resolveSampling(baseline.run.profile, {
    flag: args.samples,
    env: process.env.AUDIT_SAMPLES,
    config: config.sampling ?? null,
  });
  const baselineCaps = engineMod.PROFILES[baseline.run.profile];
  const baselineSampling = baseline.run.sampling ?? {
    samples: baselineCaps.scoredSamples,
    tiebreak: baselineCaps.scoredTiebreak,
  };
  if (args.samples === undefined && requestedSampling.samples !== baselineSampling.samples) {
    throw new Error(
      `Refused: this baseline was frozen with ${baselineSampling.samples}x samples per scored question, but the current default now resolves to ${requestedSampling.samples}x. Pass samples=${baselineSampling.samples} to verify with the baseline's own counts, or samples=${requestedSampling.samples} to verify at the new default.`,
    );
  }

  const { keys } = resolveKeys(cwd);
  if (!hasMinimumKeys(keys)) throw missingKeysError();
  applyKeysToEnv(keys);

  // judge/judge_family/models: same precedence as
  // `saylent verify --judge/--judge-family/--model`. `skip`/`user_agent`/
  // `max_pages`/`allow_private`/`locale` are accepted on VerifyToolArgs for
  // parity but never threaded below — a verify never crawls, fetches corpus,
  // checks gates, or generates a fresh question set (see commands/verify.ts's
  // HELP text for the same accepted-but-no-effect fields).
  const modelSelection = resolveModelSelection(args, engineMod.familyOfModel);
  const table = engineMod.resolveModelTable({ flags: modelSelection, config: config.models });
  const models = engineMod.modelRegistry(table);
  const roles = engineMod.resolveRoles(engineMod.availableFamilies(), { flags: modelSelection, config: config.models });

  const estimate = estimateCostRange(engineMod, baseline.run.profile, baseline.run.engines as Engine[], {
    sampling: requestedSampling,
    questions: baseline.questions,
  });
  const spendCheck = checkSpendCap(estimate.highUsd, { maxUsd: args.max_usd });
  if (!spendCheck.ok) throw new Error(spendCheck.reason);

  deps.log?.(
    `verify ${baseline.brand_model.domain} · same ${baseline.questions.length} frozen questions · est. $${estimate.lowUsd.toFixed(2)}-${estimate.highUsd.toFixed(2)}`,
  );

  // Same sibling dated directory `saylent verify` writes into, so a verify
  // never clobbers the baseline it was measured against.
  const baseDir = path.dirname(baselinePath);
  const dateDir = path.join(path.dirname(baseDir), new Date().toISOString().slice(0, 10));

  const { result, current, runJsonPath, movementHtmlPath } = await runVerifyToFilesWith(
    engineMod,
    reportMod,
    {
      runId: randomUUID(),
      baselinePath,
      keys,
      models,
      roles,
      sampling: { samples: args.samples ?? null, sampling: config.sampling ?? null },
      format: args.format,
      deps: deps.pipeline,
      ...stageLogger(deps.log),
    },
    dateDir,
  );

  if (result.costUsd > 0) recordSpend(result.costUsd);

  const { verdict, band } = verdictAndBand(result);
  return {
    verdict,
    band,
    summary_blocks: briefFromBundle(current, reportDataFromBundle, buildBrief),
    report_paths: writtenPaths({ run_json: runJsonPath, movement_html: movementHtmlPath }),
    cost_usd: Math.round(result.costUsd * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// gate_check ($0)
// ---------------------------------------------------------------------------

export async function gateCheckTool(deps: McpToolDeps, args: { domain: string }): Promise<GateCheckResult> {
  const gateEngine = await deps.gate();
  const lines: string[] = [];
  const exitCode = await runGateCheckWith(
    gateEngine,
    args.domain,
    (l) => lines.push(l),
    deps.fetcher ?? gateEngine.safeFetch,
  );
  const report = lines.join("");
  const resultWord = /Result\s+(\w+)/.exec(report)?.[1] ?? (exitCode === 0 ? "PASS" : "FAIL");
  return { domain: args.domain, result: resultWord, exit_code: exitCode, report: report.trim(), cost_usd: 0 };
}

// ---------------------------------------------------------------------------
// read_report ($0)
// ---------------------------------------------------------------------------

export async function readReportTool(
  deps: McpToolDeps,
  args: { bundle_path: string; section?: string },
): Promise<ReadReportResult> {
  const { readBundle, reportDataFromBundle, buildBrief } = await deps.bundle();
  const bundlePath = resolveBundlePath(args.bundle_path);
  const bundle: RunBundleV1 = loadBundleFileWith({ readBundle }, bundlePath);
  const brief = briefFromBundle(bundle, reportDataFromBundle, buildBrief);
  // `section: "questions"` returns the run's
  // frozen question set (the same rows run.json/questions.json carry), a
  // fourth section alongside every Brief card id/anchor.
  const sections = [...sectionNames(brief), "questions"];

  let blocks: Brief | unknown = brief;
  if (args.section) {
    const wanted = args.section.trim().toLowerCase();
    if (wanted === "questions") {
      blocks = bundle.questions;
    } else {
      const picked = briefSection(brief, args.section);
      if (picked === null) {
        throw new Error(`No section "${args.section}" in this report. Available sections: ${sections.join(", ")}.`);
      }
      blocks = picked;
    }
  }

  return {
    bundle_path: bundlePath,
    brand: bundle.brand_model.brand,
    domain: bundle.brand_model.domain,
    profile: bundle.run.profile,
    measured_at: bundle.run.finished_at ?? bundle.run.started_at ?? null,
    summary_blocks: blocks,
    sections,
    cost_usd: 0,
  };
}
