// Implements ARCHITECTURE.md (pipeline) — the WHOLE audit pipeline as one pure function.
//
// This is the code that used to live inside src/inngest/functions.ts. It is
// lifted here verbatim in behavior (same stage order, same per-engine isolation,
// same adaptive tiebreak, same cost math) with every platform concern pushed out
// behind three seams:
//
//   deps.step   a step runner. Inngest passes its own `step.run`, so each step
//               below is still ONE durable, memoized, individually-retried step
//               with the SAME id it has today. The default runner just calls the
//               function, so the CLI / tests run the identical code path with no
//               durability layer at all.
//   deps.db     the DbWriter port (types.ts). The app passes the Supabase
//               service-role writer; the CLI passes MemoryDbWriter.
//   deps.hooks  the app-only side effects that must stay INSIDE a given step to
//               keep its retry semantics (site_pages stamp, brand/question-set
//               writes, the delete-first idempotency clear, the 0032/0033
//               projections, the verify baseline read, the finish notifications).
//               Every hook is optional; a CLI run supplies none and still gets a
//               complete RunResult.
//
// Nothing here may import Next, Supabase, Inngest or React (lint-enforced).
import { buildBrandModel, type LlmCall } from "./brandModel";
import type { ConfigThresholds, ExtraBot, QuestionTemplateConfig, SamplingConfig } from "./config";
import { citationHost } from "./citation-host";
import { buildCorpus, type EnrichedCorpusPageRow } from "./corpus";
import { crawlSite } from "./crawl";
import { runDomainChecks } from "./domainChecks";
import { frozenEngines, resolveEngines } from "./engines";
import { diagnose, draftArtifacts } from "./fixes";
import { type JudgeCaller, judgeOne } from "./judge";
import {
  MODELS,
  type JudgeMode,
  type ModelRegistry,
  type ResolvedRoles,
  type RoleAssignment,
  resolveRoles,
  rolesForBundle,
} from "./models";
import {
  type AskFn,
  askTiebreakDraw,
  CALL_CAP,
  type DrawRow,
  observeEngine,
  plannedDraws,
  pool,
} from "./observe";
import {
  freezeSamples,
  maxDrawsFor,
  PROFILES,
  type ProfileName,
  resolveSampling,
  type ResolvedSampling,
  sampleCountFor,
  selectQuestions,
} from "./profiles";
import { generateQuestions, templateSetVersion } from "./questions";
import {
  computeScores,
  isScored,
  needsTiebreak,
  type SampleMention,
  type ScoresWithBand,
  voteAnswer,
  watchNotes,
} from "./score";
import type {
  AnswerRow,
  AnswerSampleRow,
  BrandModel,
  Citation,
  CitationRow,
  DbWriter,
  DomainCheck,
  Engine,
  Fix,
  Question,
  Scores,
  SitePage,
  SkipStages,
} from "./types";
import { normUrl } from "./util";
import type { HostLookup, SafeFetchResult } from "./util";
import { answerCents } from "./answer-cost";

/** METHODOLOGY.md (model registry) cost map — the per-CALL fallback estimates for the non-answer
 *  roles. The per-ANSWER rates live in answer-cost.ts (one source of truth). */
export const ROLE_COST_CENTS = { judge: 0.4, drafter: 2.5, brand: 2 } as const;

export type RunKind = "audit" | "verify";

/** Structurally identical to util.safeFetch — the injectable fetch seam every
 *  network-touching engine module already accepts. Declared (not `typeof
 *  safeFetch`) so this module never pulls the real fetcher into its graph. */
export type Fetcher = (
  url: string,
  opts?: { ua?: string; timeoutMs?: number; maxRedirects?: number; lookup?: HostLookup },
) => Promise<SafeFetchResult>;

/** The frozen envelope stored next to a brand's question set: the questions, the
 *  template-set version they were generated from, and the answer-engine set. */
export interface QuestionSetEnvelope {
  questions: Question[];
  version: number;
  engines: string[];
}

/** A step runner. `step.run(id, fn)` must run `fn` at most once per run id and
 *  memoize its result — exactly Inngest's contract. The default runs inline. */
export interface StepRunner {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

const directStep: StepRunner = { run: (_name, fn) => fn() };

/** Coarse pipeline stage, for a CLI progress line. The fine-grained live labels
 *  ("Asking Gemini · 3/6 answered") still go through db.setStage. */
export type RunStage =
  | "crawl"
  | "brand-model"
  | "questions"
  | "observe"
  | "judge"
  | "corpus"
  | "domain-checks"
  | "fixes"
  | "score";

/** What the app reads out of the baseline run so the engine can compute movement. */
export interface VerifyBaseline {
  scores: Scores | null;
  answers: AnswerRow[];
  publishedFixes: Fix[];
}

/** Handed to hooks.onFinished AFTER db.finishRun, inside the same durable step. */
export interface RunFinishSummary {
  runId: string;
  kind: RunKind;
  brand: string;
  scores: ScoresWithBand;
  /** verify only: the baseline's recommended count (0 when there is none) */
  baselineRecommended: number;
  costUsd: number;
}

/** App-only side effects that must run INSIDE the step that owns them. */
export interface RunAuditHooks {
  /** crawl step, after crawlSite: the app stamps runs.site_pages. */
  onSitePages?(pages: SitePage[]): Promise<void> | void;
  /** brand-model step: the app persists derived fields + the 0034 snapshot. */
  onBrandModel?(model: BrandModel): Promise<void> | void;
  /** questions step, only when a NEW set was generated: persist the envelope. */
  onQuestionSet?(envelope: QuestionSetEnvelope): Promise<void> | void;
  /** judge step, before any insert: delete-first idempotency for this run. */
  beforePersistAnswers?(runId: string): Promise<void> | void;
  /** judge step: the 0033 per-sample evidence projection. */
  onAnswerSamples?(rows: AnswerSampleRow[]): Promise<void> | void;
  /** judge step: the 0032 flattened citation projection. */
  onCitations?(rows: CitationRow[]): Promise<void> | void;
  /** finish step: read the baseline run a verify measures movement against. */
  loadVerifyBaseline?(baselineRunId: string): Promise<VerifyBaseline | null>;
  /** finish step, after finishRun: notifications, credit consumption, analytics. */
  onFinished?(summary: RunFinishSummary): Promise<void> | void;
}

export interface RunAuditDeps {
  db: DbWriter;
  /** the ONE ask seam — identical for observe draws AND adaptive tiebreaks */
  ask: AskFn;
  llm: { brandModel: LlmCall; drafter: LlmCall; judge: JudgeCaller };
  /** which family serves which judgment role (models.ts). Default: resolved from
   *  the keys this process has — one key ⇒ single-family judging. */
  roles?: ResolvedRoles;
  /** the resolved model registry (flag > env > saylent.config > default), used
   *  for the ANSWER-model names in the run header. Default: MODELS. */
  models?: ModelRegistry;
  /** SSRF-guarded fetcher for crawl / corpus / domain checks (default safeFetch) */
  fetcher?: Fetcher;
  step?: StepRunner;
  hooks?: RunAuditHooks;
  /** coarse progress for a CLI narration line (default: no-op) */
  onStage?(stage: RunStage, detail: string): void;
  /** 0038 hygiene: throw to abort the pipeline before spending (default: no-op) */
  assertNotCancelled?(): Promise<void>;
}

export interface RunAuditInput {
  runId: string;
  kind: RunKind;
  profile: ProfileName;
  brand: {
    id?: string;
    name: string;
    domain: string;
    category?: string | null;
    competitors?: string[] | null;
    /** verify only — the stored model fields a verify run rebuilds bm from */
    aliases?: string[] | null;
    icp?: string | null;
    problems?: string[] | null;
  };
  /** icp/problems the OWNER edited: passed straight into buildBrandModel. */
  overrides?: { icp?: string; problems?: string[] };
  /** the brand's live answer-engine selection (null/legacy → all four) */
  engines?: string[] | null;
  /** the FROZEN question set to reuse; required for kind="verify" */
  questionSet?: { questions?: Question[]; version?: number; engines?: string[] } | null;
  /** version stamped on a NEWLY generated envelope (default 1) */
  questionSetVersion?: number | null;
  baselineRunId?: string | null;
  currentYear?: number;
  /** engine-visible feature flags (today: the drafter's CoVe audit pass) */
  flags?: { coveAudit?: boolean };
  /** Optional cap on crawled pages (CLI --max-pages / config maxPages); never above the profile's cap. */
  maxPages?: number | null;
  /** saylent.config `questionTemplates` — merged onto the shipped library when
   *  a NEW question set is generated (questions.ts resolveTemplates). A frozen
   *  set is still reused verbatim, so this never re-writes an existing brand. */
  questionTemplates?: QuestionTemplateConfig | null;
  /** saylent.config `extraBots` — merged into the BOT_REGISTRY gate checks */
  extraBots?: ExtraBot[] | null;
  /** saylent.config `thresholds` — coverage cut-off + fix-weight overrides */
  thresholds?: ConfigThresholds | null;
  /** the app's own domain, excluded from the site's own-citation checks */
  appDomain?: string;
  /** Samples feature: --samples flag (run level), 1-5. Highest precedence —
   *  see profiles.resolveSampling for the full flag > env > config > profile
   *  order (AUDIT_SAMPLES is read directly from process.env here). */
  samples?: number | null;
  /** saylent.config `sampling` — the config layer of the same precedence. */
  sampling?: SamplingConfig | null;
  /** Skip the costly pipeline stages. `drafts`:
   *  no drafter LLM calls (diagnose() still runs; fixes are saved without
   *  artifacts). `corpus`: no cited-page fetches. `gates`: no site checks.
   *  Absent/false ⇒ byte-identical to today. Ignored on `kind: "verify"` —
   *  a verify run never touches these stages regardless (see the `!isVerify`
   *  guard below), so there is nothing left to skip. */
  skip?: SkipStages | null;
}

export interface RunResult {
  status: "done" | "failed";
  /** set only when status="failed" (today: the call-cap backstop) */
  failure?: string;
  runId: string;
  kind: RunKind;
  profile: ProfileName;
  engines: Engine[];
  brandModel: BrandModel;
  /** the FROZEN set (every question the brand owns) */
  frozenQuestions: Question[];
  /** the questions this profile actually asked */
  questions: Question[];
  questionSetVersion: number;
  /** questions.ts templateSetVersion: 2, or "2+custom" when saylent.config
   *  questionTemplates changed the library this set was generated from. */
  templateSetVersion: number | string;
  models: Record<string, string>;
  /** "cross-family" (two provider keys) or "single-family" (one) */
  judgeMode: JudgeMode;
  /** the resolved role → family/model map this run judged and drafted with */
  roles: ResolvedRoles;
  sitePages: SitePage[];
  /** every draw, including adaptive tiebreaks — the lossless sample record */
  draws: DrawRow[];
  answers: AnswerRow[];
  samples: AnswerSampleRow[];
  citations: CitationRow[];
  corpus: EnrichedCorpusPageRow[];
  checks: DomainCheck[];
  fixes: Fix[];
  scores: ScoresWithBand | null;
  judgeCalls: number;
  parseFailures: number;
  costUsd: number;
  startedAt: string;
  finishedAt: string;
  /** Samples feature: the resolved run-level sample count/tiebreak/source this
   *  run used for any scored question with no per-question override — stamped
   *  into the bundle header (bundle.ts BundleRunMeta.sampling) for display and
   *  for the verify refusal guard (commands/verify.ts). */
  sampling: ResolvedSampling;
  /** The skip this run actually honored (echoes
   *  input.skip; null/absent when nothing was skipped), stamped into the
   *  bundle's run meta so a reader of run.json never mistakes an absent
   *  stage for one that ran and found nothing. Optional so a RunResult built
   *  before this feature existed (fixtures, tests) still type-checks. */
  skip?: SkipStages | null;
}

/** Which questions this profile asks. Identical to profiles.selectQuestions
 *  unless the frozen set carries USER-AUTHORED questions (`source: "user"`, from
 *  a CLI --questions file): those were typed by the operator on purpose, so a
 *  smoke run asks all of them and fills the remaining smoke budget with the
 *  template selection instead of silently dropping the user's own questions.
 *  A full run asks the whole frozen set either way. */
export function selectForProfile(frozen: Question[], profile: ProfileName): Question[] {
  const authored = frozen.filter((q) => q.source === "user");
  if (profile === "full" || authored.length === 0) return selectQuestions(frozen, profile);
  const templated = selectQuestions(
    frozen.filter((q) => q.source !== "user"),
    profile,
  );
  const room = Math.max(0, PROFILES[profile].questions - authored.length);
  return [...authored, ...templated.slice(0, room)];
}

/** The models this run used, by role — stamped into the bundle header so a
 *  report can say which model produced which layer. */
export function modelsUsed(
  engines: Engine[],
  roles: ResolvedRoles = resolveRoles(),
  registry: ModelRegistry = MODELS,
): Record<string, string> {
  const answer: Record<Engine, string> = {
    chatgpt: registry.chatgptAnswer,
    claude: registry.claudeAnswer,
    gemini: registry.geminiAnswer,
    perplexity: registry.perplexityAnswer,
  };
  const used: Record<string, string> = {};
  for (const e of engines) used[e] = answer[e];
  used.judge_anthropic = registry.judgeAnthropic;
  used.judge_openai = registry.judgeOpenai;
  // brand + drafter come from the RESOLVED roles: in single-provider mode they
  // run on the family that has a key, so the header must name that model.
  used.brand = roles.roles.brand.model;
  used.drafter = roles.roles.drafter.model;
  return used;
}

/** The bundle header's role map: role name → {family, model}. */
export function runRoles(roles: ResolvedRoles): Record<string, RoleAssignment> {
  return rolesForBundle(roles);
}

/**
 * Run one audit (or verify) end to end.
 *
 * STEP BOUNDARIES (unchanged from the Inngest function this was lifted from):
 *   crawl · brand-model · questions        audit only
 *   observe:<engine>                       one per engine, failures isolated
 *   judge                                  judge + vote + tiebreak + persist
 *   corpus · domain-checks · fixes         audit only
 *   finish                                 score + finishRun + notifications
 *
 * Errors are NOT caught here: the caller owns failRun / retry / reporting
 * exactly as it does today.
 */
export async function runAudit(input: RunAuditInput, deps: RunAuditDeps): Promise<RunResult> {
  const { db, ask, llm } = deps;
  const step = deps.step ?? directStep;
  // ONE role resolution per run: every judge call, the brand model and the
  // drafter use it, and it is stamped into the result so the report can say
  // whether the judging was cross-family or single-family.
  const roles = deps.roles ?? resolveRoles();
  // The template-set stamp this run is worth: "2" for the shipped library,
  // "2+custom" when saylent.config questionTemplates changed it (verify refuses
  // to claim movement across two different template sets).
  const templateVersion = templateSetVersion(input.questionTemplates ?? undefined);
  const hooks = deps.hooks ?? {};
  const onStage = deps.onStage ?? (() => {});
  const assertNotCancelled = deps.assertNotCancelled ?? (async () => {});
  const fetcher = deps.fetcher;

  const runId = input.runId;
  const profile = input.profile;
  const caps = PROFILES[profile];
  const isVerify = input.kind === "verify";
  const year = input.currentYear ?? new Date().getFullYear();
  const startedAt = new Date().toISOString();
  const brandId = input.brand.id ?? "";
  // The audit-only stages this run skips (a
  // verify never reaches any of them — see the `!isVerify` guards below, so
  // there is nothing to honor there regardless of what the caller passed).
  const skip: SkipStages = input.skip ?? {};
  const echoedSkip: SkipStages | null =
    !isVerify && (skip.drafts || skip.corpus || skip.gates)
      ? { ...(skip.drafts ? { drafts: true } : {}), ...(skip.corpus ? { corpus: true } : {}), ...(skip.gates ? { gates: true } : {}) }
      : null;
  // Samples feature: ONE resolution per run — --samples flag > AUDIT_SAMPLES
  // env > saylent.config sampling > the profile default. Frozen (audit) or
  // reused (verify, via each question's own stamped q.samples — see
  // freezeSamples below); a fresh audit stamps this value onto every
  // question that doesn't already carry its own override.
  const resolvedSampling = resolveSampling(profile, {
    flag: input.samples ?? undefined,
    env: process.env.AUDIT_SAMPLES,
    config: input.sampling ?? undefined,
  });

  let bm: BrandModel;
  let frozen: Question[];
  let sitePages: SitePage[] = [];
  let questionSetVersion = input.questionSet?.version ?? input.questionSetVersion ?? 1;

  // ---- crawl + brand model + questions (audit only) ----
  if (!isVerify) {
    const site = await step.run("crawl", async () => {
      onStage("crawl", input.brand.domain);
      await db.setStage(runId, "Crawling your site");
      const pages = await crawlSite(
        input.brand.domain,
        input.maxPages && input.maxPages > 0 ? Math.min(caps.crawlPages, input.maxPages) : caps.crawlPages,
        (path, n) => db.setStage(runId, `Crawling your site · ${path} (${n} pages)`),
        { fetcher },
      );
      await hooks.onSitePages?.(pages);
      return pages;
    });

    bm = await step.run("brand-model", async () => {
      onStage("brand-model", input.brand.name);
      await db.setStage(runId, "Building your brand model");
      // icp/problems merge (migration 0031): the owner's edited, NON-EMPTY buyer
      // context wins — the caller decides that and passes it in as overrides, so
      // the model carries it and the caller does not overwrite it afterwards.
      const model = await buildBrandModel(
        {
          brand: input.brand.name,
          domain: input.brand.domain,
          category: input.brand.category || undefined,
          competitors: (input.brand.competitors ?? []).filter(Boolean),
        },
        site,
        llm.brandModel,
        { icp: input.overrides?.icp, problems: input.overrides?.problems },
      );
      await hooks.onBrandModel?.(model);
      return model;
    });

    frozen = await step.run("questions", async () => {
      onStage("questions", `template v${templateVersion}`);
      const existing = input.questionSet;
      // Samples feature: this is the ONE moment a brand's question set is
      // frozen, so it is also the one moment each question's EFFECTIVE sample
      // count gets stamped (an explicit --questions row override survives
      // untouched; every other question gets today's resolved run-level
      // count) — a later verify then reuses these exact counts verbatim,
      // never a freshly re-resolved default (freezeSamples doc comment).
      if (existing?.questions?.length) return freezeSamples(existing.questions, resolvedSampling.samples);
      const qs = freezeSamples(generateQuestions(bm, year, input.questionTemplates ?? undefined), resolvedSampling.samples);
      // ENGINE-SELECT: freeze the answer-engine set INSIDE the envelope, next to
      // the frozen questions, so a later verify reuses this exact set.
      const envelope: QuestionSetEnvelope = {
        questions: qs,
        version: input.questionSetVersion ?? 1,
        engines: resolveEngines(input.engines),
      };
      await hooks.onQuestionSet?.(envelope);
      return qs;
    });
    questionSetVersion = input.questionSet?.version ?? input.questionSetVersion ?? 1;

    sitePages = site; // reused by the domain-checks step
  } else {
    // verify: reuse the frozen set verbatim; brand model from stored fields
    bm = {
      brand: input.brand.name,
      domain: input.brand.domain,
      aliases: input.brand.aliases?.length ? input.brand.aliases : [input.brand.name],
      category: input.brand.category ?? "product",
      icp: input.brand.icp ?? "teams evaluating options",
      products: [],
      value_props: [],
      problems: input.brand.problems ?? [],
      competitors: input.brand.competitors ?? [],
      language: "en",
    };
    const stored = input.questionSet;
    if (!stored?.questions?.length) throw new Error("verify run without a frozen question set");
    frozen = stored.questions;
  }

  const questions = selectForProfile(frozen, profile);

  // ENGINE-SELECT: the FROZEN answer-engine set for this run — the envelope's
  // engines when present, else resolved from the brand's live selection.
  const engines = frozenEngines(input.questionSet ?? null, input.engines ?? null);
  const models = modelsUsed(engines, roles, deps.models ?? MODELS);

  // ---- observe: ONE step per engine (partial-failure isolation). SCORED
  // questions get resolvedSampling.samples INITIAL draws per engine (a
  // per-question override wins for that one question); a possible +1
  // adaptive tiebreak is asked later in the judge step, only for a group
  // whose EFFECTIVE count is exactly 2. The call-cap guard budgets the WORST
  // case (maxDrawsFor, incl. that tiebreak). ----
  const sc = (q: Question) => sampleCountFor(q, resolvedSampling.samples);
  const maxSc = (q: Question) => maxDrawsFor(q, resolvedSampling);
  if (plannedDraws(questions, engines, maxSc) > CALL_CAP) {
    await db.failRun(runId, "internal call-cap guard");
    return {
      status: "failed",
      failure: "call cap",
      runId,
      kind: input.kind,
      profile,
      engines,
      brandModel: bm,
      frozenQuestions: frozen,
      questions,
      questionSetVersion,
      templateSetVersion: templateVersion,
      models,
      judgeMode: roles.judgeMode,
      roles,
      sitePages,
      draws: [],
      answers: [],
      samples: [],
      citations: [],
      corpus: [],
      checks: [],
      fixes: [],
      scores: null,
      judgeCalls: 0,
      parseFailures: 0,
      costUsd: 0,
      startedAt,
      finishedAt: new Date().toISOString(),
      sampling: resolvedSampling,
      skip: echoedSkip,
    };
  }

  const draws: DrawRow[] = [];
  for (const engine of engines) {
    const rows = await step.run(`observe:${engine}`, async () => {
      onStage("observe", engine);
      await assertNotCancelled();
      return observeEngine(engine, questions, bm, ask, db, runId, sc);
    });
    draws.push(...rows);
  }

  // ---- judge + settle: judge EVERY draw, majority-vote each canonical answer,
  // persist the canonical rows + per-sample evidence + flattened citations
  // (migration 0032/0033). Idempotent (delete-first) since answers has no unique
  // key and this step re-runs whole on a retry. ----
  //
  // PAYLOAD DISCIPLINE: the step returns ONLY what the pipeline needs downstream
  // (exactly what it returns today). Every draw / sample / citation is recorded
  // into `recorded` instead — Inngest caps a step's output at 4MB and inflating
  // this step with every raw_text a run produced would walk straight back into
  // a past retry-duplication incident. The recording is re-assigned (never appended) so a step retry
  // cannot double it. On a MEMOIZED replay the step body does not run, so
  // `recorded` stays empty; the durable caller never reads it (it persists these
  // rows through the hooks inside the step), and an in-process caller (CLI, test)
  // always executes the body. The lossless copies live in the DbWriter.
  const recorded: {
    draws: DrawRow[];
    samples: AnswerSampleRow[];
    citations: CitationRow[];
  } = { draws: [], samples: [], citations: [] };
  const settled = await step.run("judge", async () => {
    onStage("judge", `${draws.length} draws`);
    await assertNotCancelled();
    await db.setStage(runId, "Reading the answers");
    // 1) per-draw judging (cross-family judge, concurrency-capped). Failed draws
    //    stay unjudged (no verdict) — they count as coverage gaps, never vote.
    let judgeCalls = 0;
    let parseFailures = 0;
    const judgedDraws: DrawRow[] = await pool(draws, caps.judgeConcurrency, async (d) => {
      if (!d.ok) return { ...d };
      const { verdict, parsed } = await judgeOne(d, bm, llm.judge, roles);
      judgeCalls += 1;
      if (!parsed) parseFailures += 1;
      return { ...d, verdict };
    });

    // 2) group by (qid, engine); vote → canonical; collect samples + citations.
    const groups = new Map<string, DrawRow[]>();
    for (const d of judgedDraws) {
      const k = `${d.qid}|${d.engine}`;
      const g = groups.get(k);
      if (g) g.push(d);
      else groups.set(k, [d]);
    }

    // 2b) ADAPTIVE TIEBREAK: a SCORED group whose initial draws
    //     didn't already decide the majority-of-3 vote (needsTiebreak: they
    //     disagree, or one failed) gets ONE more full-depth draw (sampleIdx =
    //     group.length), judged exactly like an observe draw. Two agreeing draws
    //     ARE the majority regardless of a third, so agreeing pairs skip it and
    //     the canonical verdict stays VOTE-IDENTICAL to always asking 3x — at ~1/3
    //     fewer scored draws. Tiebreak asks + judges fold into cost automatically
    //     (usage is SUMMED onto the canonical by voteAnswer).
    //     IDEMPOTENCY: this ask lives inside the delete-first judge step, so a
    //     judge-step retry re-asks the tiebreaks — rare and bounded (<= scored x
    //     engines). answer_samples rows for tiebreaks persist as sampleIdx 2.
    //     Samples feature: the tiebreak fires ONLY for a group whose EFFECTIVE
    //     count (its own q.samples override, or the resolved run-level
    //     default) is exactly 2 AND resolvedSampling.tiebreak is on — a
    //     per-question override to 1 or 3-5 never gets a tiebreak, matching
    //     resolveSampling's rule (n=1 no vote, n>=3 already votes over every
    //     draw).
    {
      const questionByQid = new Map(questions.map((q) => [q.qid, q]));
      const toBreak = [...groups.values()].filter((g) => {
        if (!isScored(g[0].qtype) || !resolvedSampling.tiebreak) return false;
        const question = questionByQid.get(g[0].qid);
        return !!question && sc(question) === 2 && needsTiebreak(g);
      });
      await pool(toBreak, 3, async (g) => {
        const raw = await askTiebreakDraw(g, ask);
        if (raw.ok) {
          const { verdict, parsed } = await judgeOne(raw, bm, llm.judge, roles);
          judgeCalls += 1;
          if (!parsed) parseFailures += 1;
          g.push({ ...raw, verdict });
        } else {
          g.push(raw); // a failed tiebreak stays unjudged — a coverage gap, never votes
        }
      });
    }

    const canonical: AnswerRow[] = [];
    const sampleInserts: AnswerSampleRow[] = [];
    const citationInserts: CitationRow[] = [];
    const sampleMentions: SampleMention[] = [];
    const allDraws: DrawRow[] = [];

    // Mirrors scripts/backfill-citations.ts EXACTLY so forward + backfilled runs
    // project identically: one row per citation, position = array index, skip
    // only an empty url (url is NOT NULL); host is whatever citationHost derives.
    const addCites = (qid: string, engine: Engine, cites: Citation[]) => {
      cites.forEach((c, position) => {
        const url = typeof c?.url === "string" ? c.url.trim() : "";
        if (!url) return;
        citationInserts.push({
          runId,
          brandId,
          qid,
          engine,
          url,
          normUrl: normUrl(url),
          host: citationHost(url, c.title ?? null),
          position,
        });
      });
    };

    for (const groupDraws of groups.values()) {
      const sorted = groupDraws.slice().sort((a, b) => a.sampleIdx - b.sampleIdx);
      allDraws.push(...sorted);
      const { canonical: can, representativeIdx } = voteAnswer(sorted);
      canonical.push(can);
      const multi = sorted.length > 1;
      // canonical citations (= the representative / only draw)
      addCites(can.qid, can.engine, can.citations);
      if (multi) {
        const canonicalIdx = representativeIdx ?? sorted[0].sampleIdx;
        for (const d of sorted) {
          // per-sample evidence + variance ledger (every draw, ok or failed)
          sampleInserts.push({
            runId,
            qid: d.qid,
            engine: d.engine,
            sampleIdx: d.sampleIdx,
            raw_text: d.raw_text,
            citations: d.citations,
            verdict: d.verdict ?? null,
            usage: d.usage ?? null,
          });
          if (isScored(d.qtype)) {
            sampleMentions.push({
              qid: d.qid,
              engine: d.engine,
              sampleIdx: d.sampleIdx,
              mention_type: d.verdict?.mention_type ?? null,
            });
          }
          // citations for the non-representative draws (the representative's are
          // already in the canonical projection — no double count).
          if (d.sampleIdx !== canonicalIdx) addCites(d.qid, d.engine, d.citations);
        }
      }
    }

    // 3) persist idempotently: clear any prior rows for this run, then insert.
    await hooks.beforePersistAnswers?.(runId);
    await pool(canonical, 6, (a) => db.saveAnswer({ ...a, runId }));
    await hooks.onAnswerSamples?.(sampleInserts);
    await hooks.onCitations?.(citationInserts);

    recorded.draws = allDraws;
    recorded.samples = sampleInserts;
    recorded.citations = citationInserts;

    return { judged: canonical, sampleMentions, judgeCalls, parseFailures };
  });
  const judged = settled.judged;

  let fixes: Fix[] = [];
  let corpus: EnrichedCorpusPageRow[] = [];
  let checks: DomainCheck[] = [];
  if (!isVerify) {
    // ---- corpus (battlefield) ----
    // skip.corpus ⇒ no cited-page fetches at all
    // (buildCorpus never runs) — corpus stays []; the report treats that as
    // "presence unverified (skipped by request)", never a fabricated absence.
    corpus = await step.run("corpus", async () => {
      if (skip.corpus) {
        onStage("corpus", "skipped by request");
        return [];
      }
      onStage("corpus", `${judged.length} answers`);
      return buildCorpus(judged, bm, db, runId, { top: caps.corpusTop, fetcher });
    });
    // ---- domain checks ----
    // skip.gates ⇒ no site checks run at all — checks stays []; the report's
    // gates section says "skipped by request", never a pass.
    checks = await step.run("domain-checks", async () => {
      if (skip.gates) {
        onStage("domain-checks", "skipped by request");
        return [];
      }
      onStage("domain-checks", input.brand.domain);
      return runDomainChecks(bm, questions, sitePages, db, runId, {
        currentYear: year,
        ...(input.appDomain ? { appDomain: input.appDomain } : {}),
        fetcher,
        extraBots: input.extraBots ?? null,
        coverageThreshold: input.thresholds?.coverage ?? null,
      });
    });
    // ---- fixes ----
    // skip.drafts ⇒ the deterministic diagnosis still runs (diagnose() mines
    // the same lost map from judged/corpus/checks), but draftArtifacts — the
    // ONLY drafter LLM call in the pipeline — never runs; fixes save without
    // artifacts (the report marks each "not drafted (skipped by request)").
    fixes = await step.run("fixes", async () => {
      onStage("fixes", skip.drafts ? "no drafts (skipped by request)" : "");
      await db.setStage(runId, "Writing your fix plan");
      const diagnosed = diagnose(bm, questions, judged, corpus, checks, {
        fixWeights: input.thresholds?.fixWeights ?? null,
      });
      const drafted = skip.drafts
        ? diagnosed
        : await draftArtifacts(diagnosed, bm, llm.drafter, caps.draftTop, {
            coveAudit: input.flags?.coveAudit,
          });
      for (const f of drafted) await db.saveFix({ ...f, runId });
      return drafted;
    });
  }

  // ---- score + finish (+ verify comparison) ----
  const finished = await step.run("finish", async () => {
    onStage("score", "");
    await assertNotCancelled();
    // scores carry the additive confidence band over the sample-sets.
    const scores = computeScores(judged, settled.sampleMentions);
    let verifyExtra = {};
    let baselineRecommended = 0; // the "before" count for the verify notice
    if (isVerify && input.baselineRunId) {
      const baseline = (await hooks.loadVerifyBaseline?.(input.baselineRunId)) ?? null;
      if (baseline) {
        baselineRecommended = baseline.scores?.overall?.recommended ?? 0;
        const notes = watchNotes(baseline.publishedFixes, baseline.answers, judged);
        verifyExtra = { verify: { baseline: baseline.scores ?? null, watch_notes: notes } };
      }
    }

    // cost accounting: exact usage where recorded, estimates otherwise (METHODOLOGY.md).
    // Answer cost picks up every draw automatically — the canonical usage
    // is SUMMED across draws incl. any adaptive tiebreak (voteAnswer). Judge cost
    // uses the REAL number of judge calls made.
    const draftedCount = fixes.filter((f) => f.artifact).length;
    const cents =
      judged.reduce((s, a) => s + answerCents(a), 0) +
      settled.judgeCalls * ROLE_COST_CENTS.judge +
      draftedCount * ROLE_COST_CENTS.drafter +
      (isVerify ? 0 : ROLE_COST_CENTS.brand);
    const costUsd = Math.round(cents) / 100;
    await db.finishRun(runId, { ...scores, ...verifyExtra }, costUsd);

    await hooks.onFinished?.({
      runId,
      kind: input.kind,
      brand: bm.brand,
      scores,
      baselineRecommended,
      costUsd,
    });

    return { scores, costUsd };
  });

  return {
    status: "done",
    runId,
    kind: input.kind,
    profile,
    engines,
    brandModel: bm,
    frozenQuestions: frozen,
    questions,
    questionSetVersion,
    templateSetVersion: templateVersion,
    models,
    judgeMode: roles.judgeMode,
    roles,
    sitePages,
    draws: recorded.draws,
    answers: judged,
    samples: recorded.samples,
    citations: recorded.citations,
    corpus,
    checks,
    fixes,
    scores: finished.scores,
    judgeCalls: settled.judgeCalls,
    parseFailures: settled.parseFailures,
    costUsd: finished.costUsd,
    startedAt,
    finishedAt: new Date().toISOString(),
    sampling: resolvedSampling,
    skip: echoedSkip,
  };
}
