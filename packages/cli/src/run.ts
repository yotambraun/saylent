// Wires keys -> adapters/LLM callers -> runAudit() (with MemoryDbWriter,
// safeFetch, the default step runner, and onStage -> Progress), then
// toBundle -> writeBundle, then from-bundle -> ReportData -> renderReportHtml
// / renderMarkdown. verify loads the baseline bundle, passes its `questions`
// as the frozen set, and renders renderMovementHtml(baseline, current).
//
// TESTABILITY NOTE: every function here comes in two forms — a "*With"
// version that takes the already-resolved @saylent/engine / @saylent/report
// module objects as plain parameters (used by tests, which import those
// packages STATICALLY like every other test in this repo), and a thin
// wrapper of the same name without "With" that fetches those modules via the
// dynamic engine-loader (used by the CLI commands, for dist/saylent.js
// compatibility — see engine-loader.ts). Two separate,
// verified reasons this split exists rather than calling loadEngine()
// directly everywhere:
//   1. A dynamic import() of the "@saylent/engine" barrel was measured to
//      hang/time out under vitest's own module loader — never exercised by
//      tests now, since they all use the "*With" entry points.
//   2. On this repo's dev filesystem (WSL, under /mnt/c), tsx's per-file
//      transform of the FULL barrel is genuinely slow even outside vitest —
//      measured at 2m43s for one cold import, and it came back with the
//      wrong export shape besides. engine-loader.ts's loadEngine() therefore
//      never imports the barrel; it assembles only the specific submodules
//      the CLI needs. ADAPTERS (needs @google/genai, one of the largest
//      trees involved) is kept out of even THAT and fetched lazily by
//      buildAskFn() below through its own loadAdapters(), and gate-check
//      uses a still-leaner loadGateCheckEngine() that skips llm.ts's
//      openai/@anthropic-ai/sdk imports too — so each command only pays
//      transform cost for what it actually touches.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  AskFn,
  BundleMeta,
  Engine,
  Fetcher,
  JudgeCaller,
  ModelRegistry,
  ProfileName,
  Question,
  ResolvedRoles,
  RunAuditHooks,
  RunAuditInput,
  RunBundleV1,
  RunResult,
  RunStage,
  SkipStages,
} from "@saylent/engine";
import type { ConfigThresholds, ExtraBot, QuestionTemplateConfig, SamplingConfig } from "@saylent/engine/config";
import type { LlmCall } from "@saylent/engine/brandModel";
import type { ReportData, ReportMeta } from "@saylent/report/render/types";
import { loadAdapters, loadEngine, loadReportFromBundle, loadReportRender, type EngineModule } from "./engine-loader";
import type { KeyMap } from "./keys";
import { wrapSetStage } from "./progress";
import { redactDeep, redactKnownSecrets } from "./redact";
import { reportAssetOptions } from "./repo-root";
import { glyph } from "./glyphs";

export type { Engine, ProfileName, RunResult };
export type { EngineModule } from "./engine-loader";

export interface PipelineDeps {
  /** default: a real ADAPTERS-backed AskFn built from `keys` */
  ask?: AskFn;
  /** default: the real brandModelCall/drafterCall/judgeCall (llm.ts) */
  llm?: { brandModel: LlmCall; drafter: LlmCall; judge: JudgeCaller };
  /** default: the real SSRF-guarded safeFetch */
  fetcher?: Fetcher;
}

/** The saylent.config fields the ENGINE reads (questions.ts, domainChecks.ts,
 *  coverage.ts, fixes.ts). Passed straight through to RunAuditInput. */
export interface EngineConfigOptions {
  questionTemplates?: QuestionTemplateConfig | null;
  extraBots?: ExtraBot[] | null;
  thresholds?: ConfigThresholds | null;
}

/** the four crawler-friendliness options
 *  (`--user-agent`/`--max-pages`/`--allow-private`/`--locale`, or their
 *  saylent.config equivalents). `RunAuditInput` (run-audit.ts) has no field
 *  for any of these, so this whole seam works through the extension points
 *  `runAuditToFilesWith` already has: the injectable `fetcher` (F3 UA, F6
 *  allow-private — buildCrawlerFetcher below) and the `hooks.onSitePages` /
 *  `hooks.onQuestionSet` callbacks (F3 max-pages, F5 locale —
 *  buildCrawlerHooks below), NOT new RunAuditInput fields. */
export interface CrawlerOptions {
  /** --user-agent / config userAgent — applied to every safeFetch call this
   *  run makes (crawl, corpus, domain checks): a self-hosted deployment
   *  identifies itself, not us. */
  userAgent?: string | null;
  /** --max-pages / config maxPages — caps how many crawled pages feed the
   *  brand model + corpus AFTER the crawl. The crawl's own HTTP requests
   *  still respect the profile's page budget (caps.crawlPages in
   *  run-audit.ts) — reducing THAT needs a `maxPages` field on
   *  RunAuditInput, one line at the run-audit.ts crawl step, out of this
   *  file's scope. */
  maxPages?: number | null;
  /** --allow-private / config allowPrivate — skip the SSRF private-IP guard
   *  for the audited domain's own host (and its www/apex sibling) ONLY.
   *  Never on by default; the caller is responsible for printing the risk
   *  warning (audit.ts does, before the run starts). */
  allowPrivate?: boolean;
  /** --locale / config locale — BCP47 tag. When set, a freshly generated
   *  question set is translated once via the drafter role. No effect when a
   *  --questions file is reused (nothing is freshly generated) or on
   *  `verify` (frozen questions are reused verbatim, no new set either). */
  locale?: string | null;
}

/** F3/F6 — wrap the real safeFetch with a custom user-agent and/or
 *  allowPrivate, SCOPED to the audited domain's own host (and its www/apex
 *  sibling — see @saylent/engine/crawl wwwApexSibling, mirrored inline here
 *  rather than imported, to keep this a pure composition of the existing
 *  Fetcher seam). A citation/corpus fetch to any OTHER host never gets
 *  allowPrivate, so the SSRF guard's default behavior for everything but the
 *  audited site itself is unchanged. Returns `base` unmodified when neither
 *  option is set (byte-identical to today). */
export function buildCrawlerFetcher(base: Fetcher, domain: string, opts: CrawlerOptions = {}): Fetcher {
  const { userAgent, allowPrivate } = opts;
  if (!userAgent && !allowPrivate) return base;
  const rootHost = (() => {
    try {
      return new URL(/^https?:\/\//i.test(domain) ? domain : `https://${domain}`).hostname.toLowerCase();
    } catch {
      return domain.toLowerCase();
    }
  })();
  const sibling = rootHost.startsWith("www.")
    ? rootHost.slice(4)
    : rootHost.split(".").length === 2
      ? `www.${rootHost}`
      : null;
  const isAuditedHost = (url: string): boolean => {
    try {
      const h = new URL(url).hostname.toLowerCase();
      return h === rootHost || h === sibling;
    } catch {
      return false;
    }
  };
  return (url, fetchOpts) => {
    // `allowPrivate` is not in the (narrower) Fetcher opts type — the real
    // implementation (safeFetch, util.ts) accepts it; this cast only widens
    // the STATIC type of what we pass through, not the runtime call.
    const merged: Record<string, unknown> = { ...fetchOpts };
    if (userAgent && !merged.ua) merged.ua = userAgent;
    if (allowPrivate && isAuditedHost(url)) merged.allowPrivate = true;
    return base(url, merged as Parameters<Fetcher>[1]);
  };
}

const TRANSLATE_SYSTEM =
  "You translate a numbered list of short website-audit questions into the target language. " +
  "Return ONLY the translated lines, in the SAME order, one per line, no numbering, no commentary, " +
  "no quotation marks.";

/** F5 — one drafter call translates every question's text into `locale`
 *  (BCP47). Best-effort: a missing/malformed response (wrong line count)
 *  leaves the English text untouched rather than corrupting the set. */
async function translateQuestionTexts(
  drafter: LlmCall,
  locale: string,
  questions: Pick<Question, "text">[],
): Promise<string[] | null> {
  if (questions.length === 0) return null;
  const numbered = questions.map((q, i) => `${i + 1}. ${q.text}`).join("\n");
  const out = await drafter({
    system: TRANSLATE_SYSTEM,
    user: `Target language (BCP47 tag): ${locale}\n\n${numbered}`,
    maxTokens: Math.min(4000, 200 + questions.length * 60),
  });
  if (!out) return null;
  const lines = out
    .split("\n")
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
  return lines.length === questions.length ? lines : null;
}

/** F3 (max-pages) + F5 (locale) — the two crawler options threaded through
 *  the pipeline's existing `hooks` extension points rather than new
 *  RunAuditInput fields (see CrawlerOptions doc comment). Both hooks mutate
 *  the array they are given IN PLACE — `hooks.onSitePages`/`onQuestionSet`
 *  are called with the SAME array reference run-audit.ts goes on to use
 *  (`return pages` / `return qs`), so the mutation is what downstream steps,
 *  the bundle, and the report actually see. Returns `{}` (byte-identical
 *  merge) when neither option is set. */
export function buildCrawlerHooks(
  crawler: CrawlerOptions | undefined,
  drafter: LlmCall,
): Pick<RunAuditHooks, "onSitePages" | "onQuestionSet"> {
  const hooks: Pick<RunAuditHooks, "onSitePages" | "onQuestionSet"> = {};
  if (crawler?.maxPages) {
    const maxPages = crawler.maxPages;
    hooks.onSitePages = (pages) => {
      if (pages.length > maxPages) pages.length = maxPages;
    };
  }
  if (crawler?.locale) {
    const locale = crawler.locale;
    hooks.onQuestionSet = async (envelope) => {
      const translated = await translateQuestionTexts(drafter, locale, envelope.questions);
      if (!translated) return;
      envelope.questions.forEach((q, i) => {
        const t = translated[i];
        if (t && t !== q.text) {
          q.text = t;
          (q as Question & { translated?: boolean }).translated = true;
        }
      });
    };
  }
  return hooks;
}

/** Samples feature: the run-level layers a command resolves before calling
 *  the pipeline — `samples` is the --samples flag (highest precedence),
 *  `sampling` is saylent.config's `sampling` block. AUDIT_SAMPLES env is read
 *  by the engine itself (run-audit.ts), not threaded through here. */
export interface SamplingOptions {
  samples?: number | null;
  sampling?: SamplingConfig | null;
}

export interface AuditOptions {
  runId: string;
  brandName: string;
  domain: string;
  competitors: string[];
  profile: ProfileName;
  engines: Engine[];
  keys: KeyMap;
  /** --questions <bundle-or-json>: reuse a frozen question set instead of
   *  generating a new one (ARCHITECTURE.md (frozen question set) — run-audit.ts reuses it verbatim for
   *  BOTH audit and verify when a non-empty questionSet is supplied). */
  questionSet?: { questions: Question[]; version?: number; engines?: string[] } | null;
  onStage?: (stage: RunStage, detail: string) => void;
  onLiveLabel?: (label: string) => void;
  currentYear?: number;
  deps?: PipelineDeps;
  /** the resolved model registry (--model/--judge > MODEL_* > config > default) */
  models?: ModelRegistry;
  /** the resolved judgment roles for those models and this machine's keys */
  roles?: ResolvedRoles;
  /** saylent.config fields the engine reads */
  config?: EngineConfigOptions;
  /** Samples feature: --samples flag + saylent.config sampling */
  sampling?: SamplingOptions;
  /** F3/F5/F6 — user-agent / max-pages / allow-private / locale */
  crawler?: CrawlerOptions;
  /** the resolved --skip/AUDIT_SKIP/saylent.config skip (already flag > env >
   *  config resolved by the caller, profiles.ts resolveSkip); threaded
   *  straight into RunAuditInput.skip and stamped onto the bundle's run
   *  meta. */
  skip?: SkipStages | null;
  /** --format / the MCP `format` argument: which of run.json, report.html and
   *  report.md to write. Undefined = all three. */
  format?: readonly ReportFormat[];
  /** first-line banner for a report rendered from a published SAMPLE bundle
   *  (see renderReportFilesWith). */
  sampleNotice?: string;
}

export interface AuditRun {
  result: RunResult;
  bundle: RunBundleV1;
}

/** Build the ONE ask seam (ARCHITECTURE.md (pipeline)) from resolved keys: real per-engine
 *  adapters, the registry's model per engine, the smoke/full search-depth cap.
 *  ADAPTERS comes from its own lazy loadAdapters() (engine-loader.ts), not
 *  from `engineMod` — see that module's comment: it pulls in @google/genai,
 *  which is slow to import via tsx on this repo's dev filesystem, so it is
 *  deliberately kept OUT of the general loadEngine() path and only fetched
 *  here, on an actual real (non-dry-run) run. */
export async function buildAskFn(
  engineMod: Pick<EngineModule, "MODELS" | "PROFILES">,
  keys: KeyMap,
  profile: ProfileName,
  /** the resolved registry; defaults to the env/registry snapshot */
  registry?: ModelRegistry,
): Promise<AskFn> {
  const { ADAPTERS } = await loadAdapters();
  const MODELS = registry ?? engineMod.MODELS;
  const ANSWER_MODEL: Record<Engine, string> = {
    chatgpt: MODELS.chatgptAnswer,
    claude: MODELS.claudeAnswer,
    gemini: MODELS.geminiAnswer,
    perplexity: MODELS.perplexityAnswer,
  };
  const apiKeyFor: Record<Engine, string | undefined> = {
    chatgpt: keys.openai,
    claude: keys.anthropic,
    gemini: keys.gemini,
    perplexity: keys.perplexity,
  };
  const caps = engineMod.PROFILES[profile];
  return async (engine, question) =>
    ADAPTERS[engine](question, {
      model: ANSWER_MODEL[engine],
      apiKey: apiKeyFor[engine],
      ...(engine === "claude" ? { maxSearches: caps.claudeMaxSearches } : {}),
    });
}

/** exit code: 2 on ANY provider failure among the requested
 *  engines, not only an engine that failed every draw — a partial failure
 *  (some draws 429/503'd, most succeeded) is still worth a non-zero signal so
 *  a script chain can tell "clean" apart from "ran with gaps". */
export function hasEngineFailures(engines: Engine[], answers: { engine: Engine; ok: boolean }[]): boolean {
  return engines.some((e) => answers.some((a) => a.engine === e && !a.ok));
}

export function defaultOutDir(domain: string, now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  return path.join(".", domain, date);
}

/** `--format` / the MCP `format` argument. One name per FILE the run writes:
 *  `json` = run.json (the lossless bundle every other command reads), `html` =
 *  report.html (movement.html on a verify), `md` = report.md. */
export type ReportFormat = "md" | "html" | "json";

export const ALL_FORMATS: readonly ReportFormat[] = ["md", "html", "json"];

/** Undefined (the flag was not passed) means all three, so the default output
 *  is byte-identical to what it has always been. */
export function wantsFormat(formats: readonly ReportFormat[] | undefined, format: ReportFormat): boolean {
  return formats === undefined || formats.includes(format);
}

/** A path is null when that format was not requested and therefore not
 *  written — never a path to a file that does not exist. */
export interface RenderedFiles {
  runJsonPath: string | null;
  reportHtmlPath: string | null;
  reportMdPath: string | null;
}

/** Run one audit end to end and write run.json + report.html + report.md
 *  into `outDir` — or only the subset `opts.format` asked for. Returns the
 *  RunResult, the bundle, and a path per file (null for a format that was not
 *  requested, so no caller can print a path to a file that was never
 *  written). */
export async function runAuditToFilesWith(
  engineMod: EngineModule,
  reportMod: ReportModules,
  opts: AuditOptions,
  outDir: string,
): Promise<AuditRun & RenderedFiles> {
  const { MemoryDbWriter, runAudit, toBundle, writeBundle } = engineMod;

  const db = new MemoryDbWriter();
  if (opts.onLiveLabel) wrapSetStage(db, opts.onLiveLabel);
  const ask = opts.deps?.ask ?? (await buildAskFn(engineMod, opts.keys, opts.profile, opts.models));
  const llm = opts.deps?.llm ?? {
    brandModel: engineMod.brandModelCall,
    drafter: engineMod.drafterCall,
    judge: engineMod.judgeCall,
  };
  // F3/F6 — a caller-supplied deps.fetcher (tests; a future embedding host)
  // always wins, exactly as before; otherwise wrap the real safeFetch with
  // this run's crawler options (both a no-op when unset — see
  // buildCrawlerFetcher).
  const fetcher = opts.deps?.fetcher ?? buildCrawlerFetcher(engineMod.safeFetch, opts.domain, opts.crawler);

  const input: RunAuditInput = {
    runId: opts.runId,
    kind: "audit",
    profile: opts.profile,
    brand: { name: opts.brandName, domain: opts.domain, competitors: opts.competitors },
    engines: opts.engines,
    questionSet: opts.questionSet ?? null,
    currentYear: opts.currentYear,
    questionTemplates: opts.config?.questionTemplates ?? null,
    maxPages: opts.crawler?.maxPages ?? null,
    extraBots: opts.config?.extraBots ?? null,
    thresholds: opts.config?.thresholds ?? null,
    samples: opts.sampling?.samples ?? null,
    sampling: opts.sampling?.sampling ?? null,
    skip: opts.skip ?? null,
  };

  // F3 (max-pages) + F5 (locale) — both no-ops (merges to db.hooks()
  // unchanged) unless opts.crawler asked for one.
  const result = await runAudit(input, {
    db,
    ask,
    llm,
    fetcher,
    hooks: { ...db.hooks(), ...buildCrawlerHooks(opts.crawler, llm.drafter) },
    onStage: opts.onStage,
    ...(opts.models ? { models: opts.models } : {}),
    ...(opts.roles ? { roles: opts.roles } : {}),
  });

  const meta: BundleMeta = {
    run: {
      id: opts.runId,
      kind: "audit",
      profile: opts.profile,
      status: result.status,
      brand: { name: opts.brandName, domain: opts.domain },
      engines: result.engines,
      models: result.models,
      template_set_version: result.templateSetVersion,
      question_set_version: result.questionSetVersion,
      sampling: result.sampling,
      skip: result.skip,
      judge_mode: result.judgeMode,
      roles: engineMod.runRoles(result.roles),
      started_at: result.startedAt,
      finished_at: result.finishedAt,
      est_cost_usd: result.costUsd,
      failure: result.failure ?? null,
    },
    brand_model: result.brandModel,
    questions: result.frozenQuestions,
  };
  const bundle = toBundle(db, meta);

  mkdirSync(outDir, { recursive: true });
  // LAST gate before a provider key can reach disk. The adapter boundary
  // already redacts AskResult.error, but a bundle also carries the run's
  // failure string, crawled page text and every other free-form field, and
  // run.json is the file people commit and attach to issues.
  let runJsonPath: string | null = null;
  if (wantsFormat(opts.format, "json")) {
    runJsonPath = path.join(outDir, "run.json");
    writeFileSync(runJsonPath, redactKnownSecrets(writeBundle(bundle)), "utf8");
  }

  const { reportHtmlPath, reportMdPath } = await renderReportFilesWith(reportMod, bundle, outDir, {
    formats: opts.format,
    sampleNotice: opts.sampleNotice,
  });

  return { result, bundle, runJsonPath, reportHtmlPath, reportMdPath };
}

export async function runAuditToFiles(opts: AuditOptions, outDir: string): Promise<AuditRun & RenderedFiles> {
  const [engineMod, reportMod] = await Promise.all([loadEngine(), loadReportModules()]);
  return runAuditToFilesWith(engineMod, reportMod, opts, outDir);
}

export interface ReportModules {
  reportDataFromBundle: Awaited<ReturnType<typeof loadReportFromBundle>>["reportDataFromBundle"];
  renderReportHtml: Awaited<ReturnType<typeof loadReportRender>>["renderReportHtml"];
  renderMarkdown: Awaited<ReturnType<typeof loadReportRender>>["renderMarkdown"];
  renderMovementHtml: Awaited<ReturnType<typeof loadReportRender>>["renderMovementHtml"];
}

export async function loadReportModules(): Promise<ReportModules> {
  const [{ reportDataFromBundle }, { renderReportHtml, renderMarkdown, renderMovementHtml }] = await Promise.all([
    loadReportFromBundle(),
    loadReportRender(),
  ]);
  return { reportDataFromBundle, renderReportHtml, renderMarkdown, renderMovementHtml };
}

/** The brand domain of the published sample bundle this repo ships. A report
 *  rendered from it carries the banner below, so a reader who opens the file
 *  out of context cannot mistake the fictional company for a real audit
 *  subject, nor the replaced competitor names for real ones. */
export const SAMPLE_BRAND_DOMAIN = "saylent-kestrel.vercel.app";

export const SAMPLE_NOTICE =
  "Kestrel Uptime is a fictional company we audit; names of other companies are replaced";

/** The banner for this bundle, or undefined for a real customer's run. */
export function sampleNoticeFor(bundle: Pick<RunBundleV1, "brand_model">): string | undefined {
  return bundle.brand_model.domain === SAMPLE_BRAND_DOMAIN ? SAMPLE_NOTICE : undefined;
}

export interface RenderReportFilesOptions {
  /** which files to write; undefined = both report.html and report.md */
  formats?: readonly ReportFormat[];
  /** first line / banner marking a report rendered from a sample bundle */
  sampleNotice?: string;
}

/** report.html + report.md from an already-written (or freshly built) bundle.
 *  A path comes back null when `opts.formats` did not ask for that file. */
export async function renderReportFilesWith(
  reportMod: ReportModules,
  bundle: RunBundleV1,
  outDir: string,
  opts: RenderReportFilesOptions = {},
): Promise<{ reportHtmlPath: string | null; reportMdPath: string | null }> {
  const { reportDataFromBundle, renderReportHtml, renderMarkdown } = reportMod;
  // Redaction happens HERE, on the data, not on the rendered file. report.html
  // embeds a minified React/Tailwind bundle; running the shape regexes over the
  // finished document rewrote `this.key=t` and `mask-linear-from-…` inside that
  // bundle and broke hydration outright (see redactDeep's note). Every string
  // that reaches the data island or the server-rendered markup is cleaned here,
  // and the document is then written byte-for-byte as rendered.
  const data: ReportData = redactDeep(reportDataFromBundle(bundle));
  const sampleNotice = redactDeep(opts.sampleNotice ?? sampleNoticeFor(bundle));

  // `skip` is carried as an extra, cast-only field (same convention
  // from-bundle.ts/markdown.ts use for run.health/run.brand_model): ReportMeta
  // itself has no `skip` field, so document.tsx's masthead reads it back via a
  // cast, exactly like dossier.tsx already does for run.health.
  const meta: ReportMeta = redactDeep<ReportMeta>({
    profile: bundle.run.profile,
    engines: bundle.run.engines,
    models: bundle.run.models,
    cost: bundle.run.est_cost_usd,
    // one provider key ⇒ the header and the Brief say the judging was
    // single-family (weaker self-preference control) — see judge_mode.
    judgeMode: bundle.run.judge_mode ?? undefined,
    skip: bundle.run.skip ?? null,
  });

  mkdirSync(outDir, { recursive: true });
  const wantHtml = wantsFormat(opts.formats, "html");
  const wantMd = wantsFormat(opts.formats, "md");
  const reportHtmlPath = wantHtml ? path.join(outDir, "report.html") : null;
  const reportMdPath = wantMd ? path.join(outDir, "report.md") : null;
  // The report is the artifact a founder mails, publishes and pastes into a
  // PR; a provider error printed inside it must never carry the key. `data`,
  // `meta`, the title and the notice are already redacted above, so the HTML
  // is written exactly as rendered — its embedded bundle must stay valid JS.
  if (reportHtmlPath) {
    const html = await renderReportHtml(data, {
      // prebuilt dist/assets when this CLI has them, build-at-render inside a
      // checkout otherwise (repo-root.ts)
      ...reportAssetOptions(),
      title: redactKnownSecrets(`${bundle.brand_model.brand} ${glyph("sep")} Saylent report`),
      generatedAt: redactKnownSecrets(bundle.run.finished_at ?? bundle.run.started_at),
      theme: "auto",
      meta,
      sampleNotice,
    });
    writeFileSync(reportHtmlPath, html, "utf8");
  }
  // Markdown carries no code, so the belt-and-braces pass over the finished
  // text stays: it is plain prose either way.
  if (reportMdPath) {
    const md = renderMarkdown(data, { sampleNotice });
    writeFileSync(reportMdPath, redactKnownSecrets(md), "utf8");
  }
  return { reportHtmlPath, reportMdPath };
}

export async function renderReportFiles(
  bundle: RunBundleV1,
  outDir: string,
  opts: RenderReportFilesOptions = {},
): Promise<{ reportHtmlPath: string | null; reportMdPath: string | null }> {
  const reportMod = await loadReportModules();
  return renderReportFilesWith(reportMod, bundle, outDir, opts);
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

export interface VerifyOptions {
  runId: string;
  baselinePath: string;
  keys: KeyMap;
  /** the resolved model registry (--model/--judge > MODEL_* > config > default) */
  models?: ModelRegistry;
  /** the resolved judgment roles for those models and this machine's keys */
  roles?: ResolvedRoles;
  onStage?: (stage: RunStage, detail: string) => void;
  onLiveLabel?: (label: string) => void;
  currentYear?: number;
  deps?: PipelineDeps;
  /** Samples feature: --samples flag + saylent.config sampling */
  sampling?: SamplingOptions;
  /** --format / the MCP `format` argument. Undefined = run.json + movement.html. */
  format?: readonly ReportFormat[];
}

export function loadBundleFileWith(engineMod: Pick<EngineModule, "readBundle">, file: string): RunBundleV1 {
  return engineMod.readBundle(JSON.parse(readFileSync(file, "utf8")));
}

export async function loadBundleFileAsync(file: string): Promise<RunBundleV1> {
  const engineMod = await loadEngine();
  return loadBundleFileWith(engineMod, file);
}

export interface VerifyRun {
  result: RunResult;
  baseline: RunBundleV1;
  current: RunBundleV1;
}

export async function runVerifyToFilesWith(
  engineMod: EngineModule,
  reportMod: ReportModules,
  opts: VerifyOptions,
  outDir: string,
): Promise<VerifyRun & { runJsonPath: string | null; movementHtmlPath: string | null }> {
  const { MemoryDbWriter, runAudit, toBundle, writeBundle } = engineMod;

  const baseline = loadBundleFileWith(engineMod, opts.baselinePath);
  const bm = baseline.brand_model;

  const db = new MemoryDbWriter();
  if (opts.onLiveLabel) wrapSetStage(db, opts.onLiveLabel);
  const ask = opts.deps?.ask ?? (await buildAskFn(engineMod, opts.keys, baseline.run.profile, opts.models));
  const llm = opts.deps?.llm ?? {
    brandModel: engineMod.brandModelCall,
    drafter: engineMod.drafterCall,
    judge: engineMod.judgeCall,
  };
  const fetcher = opts.deps?.fetcher ?? engineMod.safeFetch;

  const input: RunAuditInput = {
    runId: opts.runId,
    kind: "verify",
    profile: baseline.run.profile,
    brand: {
      name: bm.brand,
      domain: bm.domain,
      category: bm.category,
      competitors: bm.competitors,
      aliases: bm.aliases,
      icp: bm.icp,
      problems: bm.problems,
    },
    engines: baseline.run.engines,
    questionSet: {
      questions: baseline.questions,
      version: baseline.run.question_set_version,
      engines: baseline.run.engines,
    },
    baselineRunId: baseline.run.id,
    currentYear: opts.currentYear,
    samples: opts.sampling?.samples ?? null,
    sampling: opts.sampling?.sampling ?? null,
  };

  const result = await runAudit(input, {
    db,
    ask,
    llm,
    fetcher,
    hooks: {
      ...db.hooks(),
      loadVerifyBaseline: async () => ({
        scores: baseline.scores,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- drops `samples`; only the canonical AnswerRow fields are kept
        answers: baseline.answers.map(({ samples, ...a }) => a),
        publishedFixes: baseline.fixes,
      }),
    },
    onStage: opts.onStage,
    ...(opts.models ? { models: opts.models } : {}),
    ...(opts.roles ? { roles: opts.roles } : {}),
  });

  const meta: BundleMeta = {
    run: {
      id: opts.runId,
      kind: "verify",
      profile: baseline.run.profile,
      status: result.status,
      brand: { name: bm.brand, domain: bm.domain },
      engines: result.engines,
      models: result.models,
      template_set_version: result.templateSetVersion,
      question_set_version: result.questionSetVersion,
      sampling: result.sampling,
      judge_mode: result.judgeMode,
      roles: engineMod.runRoles(result.roles),
      started_at: result.startedAt,
      finished_at: result.finishedAt,
      est_cost_usd: result.costUsd,
      baseline_run_id: baseline.run.id,
      failure: result.failure ?? null,
    },
    brand_model: result.brandModel,
    questions: result.frozenQuestions,
  };
  const current = toBundle(db, meta);

  mkdirSync(outDir, { recursive: true });
  // --format on a verify: `json` is the new run.json, `html` is movement.html.
  // `md` names no file here — a verify renders no markdown — so it is accepted
  // and simply produces nothing, exactly as the help text says.
  let runJsonPath: string | null = null;
  if (wantsFormat(opts.format, "json")) {
    runJsonPath = path.join(outDir, "run.json");
    writeFileSync(runJsonPath, redactKnownSecrets(writeBundle(current)), "utf8");
  }

  let movementHtmlPath: string | null = null;
  if (wantsFormat(opts.format, "html")) {
    const { reportDataFromBundle, renderMovementHtml } = reportMod;
    // Same rule as report.html: redact the inputs, write the rendered document
    // verbatim, so the embedded hydration bundle is never rewritten.
    const movementHtml = await renderMovementHtml(
      redactDeep(reportDataFromBundle(baseline)),
      redactDeep(reportDataFromBundle(current)),
      {
        ...reportAssetOptions(),
        title: redactKnownSecrets(`${bm.brand} ${glyph("sep")} movement`),
      },
    );
    movementHtmlPath = path.join(outDir, "movement.html");
    writeFileSync(movementHtmlPath, movementHtml, "utf8");
  }

  return { result, baseline, current, runJsonPath, movementHtmlPath };
}

export async function runVerifyToFiles(
  opts: VerifyOptions,
  outDir: string,
): Promise<VerifyRun & { runJsonPath: string | null; movementHtmlPath: string | null }> {
  const [engineMod, reportMod] = await Promise.all([loadEngine(), loadReportModules()]);
  return runVerifyToFilesWith(engineMod, reportMod, opts, outDir);
}
