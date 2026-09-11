// The durable audit function. The PIPELINE itself lives in @saylent/engine
// (run-audit.ts); this file is the durable wrapper: it loads the run + brand,
// builds the service-role DbWriter, hands the engine Inngest's own `step.run`
// (so every step id, retry and memoization boundary is exactly what it was
// before the extract), and owns everything platform: Supabase reads/writes the
// DbWriter port does not cover, cancellation, notifications, run health, the
// delivered-report snapshot and the emails. kind='verify' skips
// brandModel/questions-gen/crawl/corpus/domainChecks/fixes — observe + judge +
// score + compare ONLY; the engine enforces that.
import { ADAPTERS } from "@saylent/engine/adapters";
import type { AskFn } from "@saylent/engine/observe";
import { PROFILES, type ProfileName } from "@saylent/engine/profiles";
import {
  type QuestionSetEnvelope,
  type RunAuditHooks,
  type RunAuditInput,
  runAudit as runAuditPipeline,
  type StepRunner,
  type VerifyBaseline,
} from "@saylent/engine/run-audit";
import type { AnswerRow, Engine, Scores } from "@saylent/engine/types";
import {
  assembleHealthFromDb,
  auditReadyNotice,
  createDbWriter,
  redactRunError,
  runFailedNotice,
  saveAnswerSamples,
  saveCitations,
  stampRunSnapshot,
  verifyReadyNotice,
  writeRunHealth,
  writeRunSnapshot,
} from "@/lib/db";
import { fetchDossierViaRpc } from "@/lib/dossier-data";
import { sendEmail } from "@/lib/email";
import { sitePagesMeta } from "@saylent/report/report-intel";
import { flag } from "@/lib/flags";
import { makeLlmCallers } from "@saylent/engine/llm";
import { log } from "@/lib/log";
import {
  availableFamiliesFromKeys,
  type ModelRole,
  modelRegistry,
  resolveModelTable,
  resolveRoles,
} from "@saylent/engine/models";
import { type ProviderId, resolveRunProviders } from "@/lib/provider-settings";
import type { LlmCall } from "@saylent/engine/brandModel";
import { type FrozenEnvelope, type RunOptions, runInputFromOptions } from "@/lib/question-options";
import { createRun } from "@/lib/runs";
import { reportError } from "@/lib/sentry";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest } from "./client";
import {
  type BrandSchedule,
  type CronKind,
  dispatchDelayMs,
  isEligible,
} from "./schedule";

/** Which provider key serves each answer engine, and which registry slot names its
 *  model. Static maps; the VALUES are resolved per run (see resolveRunProviders
 *  below) so an operator can change a key or a model in the admin console with no
 *  redeploy. */
const ENGINE_PROVIDER: Record<Engine, ProviderId> = {
  chatgpt: "openai",
  claude: "anthropic",
  gemini: "gemini",
  perplexity: "perplexity",
};

const ENGINE_MODEL_ROLE: Record<Engine, ModelRole> = {
  chatgpt: "chatgptAnswer",
  claude: "claudeAnswer",
  gemini: "geminiAnswer",
  perplexity: "perplexityAnswer",
};

/** 0038 hygiene: a user cancel sets status=failed ("cancelled by you"). Steps
 * re-check before spending; RunCancelled aborts the pipeline WITHOUT failRun
 * (the status is already the user's honest cancel). */
class RunCancelled extends Error {}
async function assertNotCancelled(admin: ReturnType<typeof createAdminClient>, runId: string) {
  const { data } = await admin.from("runs").select("status").eq("id", runId).single();
  if (data?.status === "failed") throw new RunCancelled("run cancelled");
}

const TRANSLATE_SYSTEM =
  "You translate a numbered list of short website-audit questions into the target language. " +
  "Return ONLY the translated lines, in the SAME order, one per line, no numbering, no commentary, " +
  "no quotation marks.";

/** T3 App/CLI parity (locale): one drafter call rewrites every freshly generated
 *  question into the chosen BCP47 language, IN PLACE, right before the envelope is
 *  frozen. Mirrors packages/cli/src/run.ts translateQuestionTexts — same prompt,
 *  same best-effort rule (a missing or wrong-length response leaves the English
 *  text untouched rather than corrupting the set). Duplicated rather than imported
 *  because @saylent/cli is not a dependency of the app. */
export async function translateQuestionTexts(
  drafter: LlmCall,
  locale: string,
  questions: { text: string }[],
): Promise<boolean> {
  if (questions.length === 0) return false;
  const numbered = questions.map((q, i) => `${i + 1}. ${q.text}`).join("\n");
  const out = await drafter({
    system: TRANSLATE_SYSTEM,
    user: `Target language (BCP47 tag): ${locale}\n\n${numbered}`,
    maxTokens: Math.min(4000, 200 + questions.length * 60),
  });
  if (!out) return false;
  const lines = out
    .split("\n")
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
  if (lines.length !== questions.length) return false;
  questions.forEach((q, i) => {
    const t = lines[i];
    if (t && t !== q.text) q.text = t;
  });
  return true;
}

export const runAudit = inngest.createFunction(
  // inngest v4: triggers live in the options object (confirmed against the installed SDK — older docs/training data show a different shape)
  {
    id: "run-audit",
    // CRON-SCALE: explicit per-user concurrency (limit 3, headroom under the
    // free-tier 5-step cap) keyed on the userId that createRun/retryRun stamps
    // onto the event — one customer's queued audits can't starve another's, and
    // concurrency doubles as the metered-LLM-spend throttle.
    concurrency: { limit: 3, key: "event.data.userId" },
    retries: 3,
    triggers: [{ event: "audit/run.requested" }],
  },
  async ({ event, step }) => {
    const runId = event.data.runId as string;
    const admin = createAdminClient();

    const ctx = await step.run("load", async () => {
      const { data: run, error } = await admin
        .from("runs")
        .select("id,kind,profile,brand_id,user_id,baseline_run_id,run_options")
        .eq("id", runId)
        .single();
      if (error || !run) throw new Error(`run ${runId} not found`);
      const { data: brand, error: be } = await admin
        .from("brands")
        .select("*")
        .eq("id", run.brand_id)
        .single();
      if (be || !brand) throw new Error(`brand ${run.brand_id} not found`);
      return { run, brand };
    });

    const db = createDbWriter(admin, ctx.run.user_id);
    const profile = (ctx.run.profile === "smoke" ? "smoke" : "full") as ProfileName;
    const caps = PROFILES[profile];
    const isVerify = ctx.run.kind === "verify";
    // Visible to the top-level catch so a run_failed notice names the
    // brand once it is known, and degrades to a brand-less message if the run
    // dies before the brand is in scope.
    let brandName: string | undefined;

    try {
      brandName = ctx.brand.name;

      // icp/problems merge (migration 0031): when the owner edited the buyer
      // context in settings (context_source='user'), their stored, NON-EMPTY
      // icp/problems win — pass them to the engine as overrides so the model
      // carries them, and DON'T overwrite them when the model comes back. A
      // cleared field (empty stored value) re-derives from the model, so the
      // fresh value is persisted for it.
      const userEdited = ctx.brand.context_source === "user";
      const storedIcp = typeof ctx.brand.icp === "string" ? ctx.brand.icp.trim() : "";
      const storedProblems = Array.isArray(ctx.brand.problems)
        ? (ctx.brand.problems as string[]).filter((p) => typeof p === "string" && p.trim())
        : [];
      const keepIcp = userEdited && storedIcp.length > 0;
      const keepProblems = userEdited && storedProblems.length > 0;

      // T3 App/CLI parity (migration 0043): the run controls the owner chose on
      // /app/brand/<id>/questions before spending — an edited question set,
      // run-level samples, the answer-engine subset, a locale, skipped stages.
      // runInputFromOptions is the pure mapping (src/lib/question-options.ts) and
      // it does exactly what packages/cli/src/run.ts does with the equivalent
      // flags. A VERIFY ignores the blob entirely and reuses the frozen baseline.
      const opts = runInputFromOptions({
        kind: isVerify ? "verify" : "audit",
        runOptions: (ctx.run.run_options as RunOptions | null) ?? null,
        brandEngines: (ctx.brand.engines as string[] | null) ?? null,
        brandQuestionSet: (ctx.brand.question_set as FrozenEnvelope | null) ?? null,
        brandQuestionSetVersion: (ctx.brand.question_set_version as number | null) ?? 1,
      });

      // Resolve THIS run's provider keys and model
      // overrides once, here: environment first, else the admin console's stored
      // values (encrypted at rest, migration 0042), else the registry default.
      // Deliberately NOT inside step.run: a step's return value is persisted in
      // Inngest's durable state, and a decrypted API key must never be written
      // there. Re-resolving on each step replay costs one cheap RPC and keeps a
      // mid-run key change honest.
      const { keys: providerKeys, overrides: modelOverrides } = await resolveRunProviders();
      const registry = modelRegistry(resolveModelTable({ overrides: modelOverrides, config: {} }));
      // resolveRunProviders no longer publishes keys into
      // process.env (a published key cannot be revoked — see its note). Keys are
      // threaded EXPLICITLY from here on. The answer engines take theirs as
      // `apiKey` below; the judgment layer (brandModelCall / drafterCall /
      // judgeCall, built by makeLlmCallers in packages/engine/src/llm.ts) takes
      // the SAME resolved keys explicitly too — no process.env read anywhere in
      // that path — so a key that lives only in the admin console reaches the
      // judge/brand/drafter exactly like an env key does.
      const llmKeys = { openai: providerKeys.openai, anthropic: providerKeys.anthropic };
      const roles = resolveRoles(availableFamiliesFromKeys(llmKeys), { overrides: modelOverrides });
      const { brandModelCall, drafterCall, judgeCall } = makeLlmCallers(llmKeys, roles);

      // The ONE ask seam — identical for observe draws AND adaptive tiebreaks
      // (same ADAPTERS call, model, key, full search depth per engine).
      const askEngine: AskFn = (eng, q) =>
        ADAPTERS[eng](q, {
          model: registry[ENGINE_MODEL_ROLE[eng]],
          apiKey: providerKeys[ENGINE_PROVIDER[eng]],
          maxSearches: eng === "claude" ? caps.claudeMaxSearches : undefined,
        });

      // Inngest's step.run IS the engine's step runner: one durable, memoized,
      // individually-retried step per pipeline step, with the same ids as before.
      const stepRunner: StepRunner = {
        run: <T,>(name: string, fn: () => Promise<T>) => step.run(name, fn) as Promise<T>,
      };

      // The platform side effects that must stay INSIDE the step that owns them.
      const hooks: RunAuditHooks = {
        // crawl step. Migration 0037: stamp own-site coverage META —
        // url/title/sitemap-date only, capped at 25, NEVER page text — for the
        // dossier's "Your site vs the buyer questions" map. sitePagesMeta is pure.
        onSitePages: async (pages) => {
          await admin.from("runs").update({ site_pages: sitePagesMeta(pages) }).eq("id", runId);
        },
        // brand-model step: persist derived fields onto the brand (user-provided
        // values won per the merge rule above; owner-kept icp/problems are omitted
        // so the edit survives the audit) + the 0034 reproducibility stamp.
        onBrandModel: async (model) => {
          await admin
            .from("brands")
            .update({
              aliases: model.aliases,
              category: model.category,
              competitors: model.competitors,
              // Migration 0036: persist the live confidence signal.
              brand_model_confidence: model.confidence ?? "ok",
              ...(keepIcp ? {} : { icp: model.icp }),
              ...(keepProblems ? {} : { problems: model.problems }),
            })
            .eq("id", ctx.brand.id);
          await stampRunSnapshot(admin, runId, { brandModel: model });
        },
        // questions step (only when a NEW set was generated): freeze the envelope
        // on the brand and stamp it on the run (createRun already stamps it for
        // re-audits/verifies that reuse a set).
        onQuestionSet: async (envelope: QuestionSetEnvelope) => {
          // T3 locale: translate the freshly generated set ONCE, before it is
          // frozen, so every future verify re-asks the same translated wording.
          // This hook only ever fires for a set the pipeline generated itself, so
          // locale correctly has no effect on a verify or on an edited draft —
          // the same rule the CLI prints ("no effect: --questions reuses a set").
          if (opts.locale) await translateQuestionTexts(drafterCall, opts.locale, envelope.questions);
          await admin.from("brands").update({ question_set: envelope }).eq("id", ctx.brand.id);
          await stampRunSnapshot(admin, runId, { questionSet: envelope });
        },
        // judge step: delete-first idempotency (answers has no unique key and the
        // step re-runs whole on a retry).
        beforePersistAnswers: async () => {
          await admin.from("citations").delete().eq("run_id", runId);
          await admin.from("answer_samples").delete().eq("run_id", runId);
          await admin.from("answers").delete().eq("run_id", runId);
        },
        onAnswerSamples: (rows) => saveAnswerSamples(admin, ctx.run.user_id, rows),
        onCitations: (rows) => saveCitations(admin, ctx.run.user_id, rows),
        // finish step: the baseline a verify run measures movement against.
        loadVerifyBaseline: async (baselineRunId): Promise<VerifyBaseline> => {
          const { data: baseRun } = await admin
            .from("runs")
            .select("scores")
            .eq("id", baselineRunId)
            .single();
          const { data: baseAnswers } = await admin
            .from("answers")
            .select("qid,qtype,question,engine,ok,raw_text,verdict")
            .eq("run_id", baselineRunId);
          const { data: publishedFixes } = await admin
            .from("fixes")
            .select("fix_key,title,factor,weight,effort,time_to_impact,engines,evidence")
            .eq("run_id", baselineRunId)
            .not("published_at", "is", null);
          return {
            scores: (baseRun?.scores as Scores | null) ?? null,
            answers: (baseAnswers ?? []).map((a) => ({ ...a, citations: [] }) as AnswerRow),
            publishedFixes: (publishedFixes ?? []).map((f) => ({
              fixKey: f.fix_key,
              title: f.title,
              factor: f.factor,
              weight: f.weight,
              effort: f.effort,
              timeToImpact: f.time_to_impact,
              engines: f.engines ?? [],
              evidence: (f.evidence as string[]) ?? [],
            })),
          };
        },
        // finish step, after finishRun: notification + credit consumption.
        onFinished: async ({ scores, baselineRecommended, brand }) => {
          // In-app notification (idempotent: the unique (run_id,type)
          // index + ignoreDuplicates make this retryable step emit at most one
          // row; notify() never throws, so a failed insert cannot fail the run).
          const notice = isVerify
            ? verifyReadyNotice(
                runId,
                baselineRecommended,
                scores.overall.recommended,
                scores.overall.answered,
              )
            : auditReadyNotice(runId, brand, scores.overall.recommended, scores.overall.answered);
          await db.notify(runId, notice.type, notice.title, notice.href);
        },
      };

      const pipelineInput: RunAuditInput = {
        runId,
        kind: isVerify ? "verify" : "audit",
        profile,
        brand: {
          id: ctx.brand.id as string,
          name: ctx.brand.name,
          domain: ctx.brand.domain,
          category: ctx.brand.category,
          competitors: (ctx.brand.competitors as string[] | null) ?? null,
          aliases: (ctx.brand.aliases as string[] | null) ?? null,
          icp: (ctx.brand.icp as string | null) ?? null,
          problems: (ctx.brand.problems as string[] | null) ?? null,
        },
        overrides: {
          icp: keepIcp ? storedIcp : undefined,
          problems: keepProblems ? storedProblems : undefined,
        },
        // T3: every one of these comes out of the ONE mapping above, so the app
        // and `saylent audit` hand runAudit the same fields for the same choices.
        engines: opts.engines,
        questionSet: opts.questionSet,
        questionSetVersion: opts.questionSetVersion,
        samples: opts.samples,
        skip: opts.skip,
        baselineRunId: (ctx.run.baseline_run_id as string | null) ?? null,
        flags: { coveAudit: flag("coveAudit") },
      };

      const result = await runAuditPipeline(pipelineInput, {
        db,
        ask: askEngine,
        llm: { brandModel: brandModelCall, drafter: drafterCall, judge: judgeCall },
        // The roles + registry this run resolved (console overrides included),
        // so the judge routing and the stamped model header match what actually ran.
        roles,
        models: registry,
        step: stepRunner,
        hooks,
        assertNotCancelled: () => assertNotCancelled(admin, runId),
      });

      if (result.status === "failed") {
        // The engine already called failRun (call-cap backstop). Same
        // run_failed notice as the top-level catch (this path returns early
        // instead of throwing).
        const nf = runFailedNotice(runId, brandName);
        await db.notify(runId, nf.type, nf.title, nf.href);
        return { failed: result.failure ?? "engine refused" };
      }

      // ---- reproducibility snapshot, part 2 (migration 0041): the role->model
      // map and template-set version this run ACTUALLY used, straight off the
      // just-returned RunResult. Own step (memoized once), best-effort — stamping
      // never fails the run (stampRunSnapshot swallows its own errors). ----
      await step.run("stamp-run-models", async () => {
        await stampRunSnapshot(admin, runId, {
          models: result.models,
          templateSetVersion: result.templateSetVersion,
        });
      });

      // ---- T3: freeze an EDITED set. runAudit only calls hooks.onQuestionSet for
      // a set it generated itself, so when the owner's draft supplied the
      // questions (the `--questions` path) nothing has written the frozen
      // envelope onto the brand yet — and without it a verify has no baseline to
      // reuse. Write it here, from the set the run actually asked, in the same
      // shape and with the same stamp the hook uses. Audits only. ----
      if (!isVerify && opts.suppliedQuestions) {
        await step.run("freeze-edited-set", async () => {
          const envelope: QuestionSetEnvelope = {
            questions: result.frozenQuestions,
            version: result.questionSetVersion,
            engines: result.engines,
          };
          await admin.from("brands").update({ question_set: envelope }).eq("id", ctx.brand.id);
          await stampRunSnapshot(admin, runId, { questionSet: envelope });
          return { frozen: envelope.questions.length };
        });
      }

      // ---- run-health "birth certificate" + delivered-report snapshot
      // (migration 0031). Its OWN step, AFTER the run is done: assemble the health
      // grade from the just-persisted rows and archive the exact dossier payload the
      // customer received. Best-effort by contract — every write swallows its own
      // errors and the whole step is wrapped, so a health/snapshot miss can NEVER
      // fail the run. Snapshot is captured FIRST so a snapshot failure is recorded
      // in health.notes before health is graded + written. ----
      await step.run("record-health", async () => {
        try {
          // 1) snapshot the delivered dossier exactly as the UI reads it (service
          //    client bypasses RLS → full payload for the run owner). Upserted (idempotent).
          const dossier = await fetchDossierViaRpc(admin, runId);
          const snapshotOk = await writeRunSnapshot(admin, runId, dossier);

          // 2) assemble health from the persisted rows and persist it. Overlay the
          //    REAL judge parse-failure count from the judge step (the run-health-build
          //    heuristic stays as the belt-and-braces estimate + the grade input).
          const health = await assembleHealthFromDb(admin, runId, "done");
          if (health) {
            health.judge_parse_failures_actual = result.parseFailures;
            if (!snapshotOk) {
              health.notes.push("snapshot_failed — the delivered-report snapshot could not be captured");
            }
            await writeRunHealth(admin, runId, health);
            return { grade: health.grade, snapshotOk };
          }
          return { skipped: "no-health", snapshotOk };
        } catch (err) {
          // Defense in depth: nothing here may throw into the pipeline.
          log.error("record-health failed", {
            runId,
            error: err instanceof Error ? err.message : String(err),
          });
          return { skipped: "error" };
        }
      });

      // ---- transactional emails (Stage 3; INERT until RESEND_API_KEY is set — sendEmail
      // no-ops without RESEND_API_KEY/EMAIL_FROM and never throws). Own steps so
      // Inngest memoizes them once (no re-send on a later step's retry). ----
      if (!isVerify) {
        // Report-ready email: reads the just-persisted scores + top fix
        // from the DB so the step is self-contained and idempotent.
        await step.run("email-dossier-ready", async () => {
          const { data: prof } = await admin
            .from("profiles")
            .select("email,email_reports")
            .eq("id", ctx.run.user_id)
            .single();
          if (!prof?.email || prof.email_reports === false) {
            return { skipped: "no-email-or-reports-off" };
          }
          const { data: r } = await admin.from("runs").select("scores").eq("id", runId).single();
          const sc = r?.scores as Scores | null;
          const { data: topFix } = await admin
            .from("fixes")
            .select("title")
            .eq("run_id", runId)
            .order("weight", { ascending: false })
            .limit(1)
            .maybeSingle();
          await sendEmail({
            to: prof.email,
            template: "dossier-ready",
            props: {
              appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
              brand: ctx.brand.name,
              recommended: sc?.overall?.recommended ?? 0,
              answered: sc?.overall?.answered ?? 0,
              topFixTitle: topFix?.title ?? undefined,
              runId,
            },
          });
          return { done: true };
        });

        // Day-10 verify reminder — only when the operator has NOT enabled
        // scheduled runs (with them on, the weekly cron verifies for you, so a
        // nudge would be noise). Handed to a DEDICATED function via event so its
        // 10-day sleepUntil doesn't pin this audit's per-user concurrency slot.
        if (!flag("scheduledRuns")) {
          await step.sendEvent("schedule-verify-reminder", {
            name: "saylent/verify.reminder.scheduled",
            data: {
              brandId: ctx.brand.id,
              userId: ctx.run.user_id,
              finishedAt: new Date().toISOString(),
            },
          });
        }
      }

      return { done: true };
    } catch (err) {
      if (err instanceof RunCancelled) {
        // User cancel: status already failed with the honest "cancelled by you" —
        // no failRun overwrite, no failure notification.
        log.info("run cancelled by user; pipeline aborted", { runId });
        return { cancelled: true };
      }
      // Redact any secret the provider echoed back before it lands in runs.error.
      await db.failRun(runId, redactRunError(err));
      // Observability: report the exception with run context (INERT without a
      // DSN) and a structured log line. reportError never throws, so it cannot
      // mask the original error.
      reportError(err, { runId, kind: ctx.run.kind, brand: brandName ?? "" });
      log.error("audit run failed", {
        runId,
        kind: ctx.run.kind,
        brand: brandName,
        error: err instanceof Error ? err.message : String(err),
      });
      // Notify the owner the run failed (brand-less if it died before
      // the brand loaded). notify() never throws, so it cannot mask the error.
      const nf = runFailedNotice(runId, brandName);
      await db.notify(runId, nf.type, nf.title, nf.href);
      // Run-health (migration 0031): grade "failed" with whatever partial rows the
      // run persisted before dying. Best-effort — must never mask the original error.
      try {
        const health = await assembleHealthFromDb(admin, runId, "failed");
        if (health) await writeRunHealth(admin, runId, health);
      } catch (healthErr) {
        log.error("failure-path health-write failed", {
          runId,
          error: healthErr instanceof Error ? healthErr.message : String(healthErr),
        });
      }
      throw err; // let Inngest record the failure (retries already exhausted per-step)
    }
  },
);


// ---------------------------------------------------------------------------
// Day-10 verify reminder — a dedicated durable function so the 10-day wait does
// NOT hold the audit function's per-user concurrency slot. Triggered by the
// audit completion, and only while scheduled runs are off. INERT without
// RESEND_API_KEY (sendEmail no-ops).
// ---------------------------------------------------------------------------
export const verifyReminder = inngest.createFunction(
  {
    id: "verify-reminder",
    concurrency: { limit: 5 },
    retries: 2,
    triggers: [{ event: "saylent/verify.reminder.scheduled" }],
  },
  async ({ event, step }) => {
    const brandId = event.data.brandId as string;
    const userId = event.data.userId as string;
    const finishedAt = event.data.finishedAt as string;

    const wakeAt = new Date(new Date(finishedAt).getTime() + 10 * 86_400_000);
    await step.sleepUntil("wait-day-10", wakeAt);

    return step.run("send-reminder", async () => {
      // Operator turned scheduled runs on during the 10-day wait? The cron
      // verifies for them — skip the nudge. Unsubscribed / no email? Skip.
      if (flag("scheduledRuns")) return { skipped: "scheduled-runs" };
      const admin = createAdminClient();
      const { data: prof } = await admin
        .from("profiles")
        .select("email,email_reports")
        .eq("id", userId)
        .single();
      if (!prof?.email || prof.email_reports === false) {
        return { skipped: "pref" };
      }
      const { data: brand } = await admin
        .from("brands")
        .select("id,name")
        .eq("id", brandId)
        .maybeSingle();
      if (!brand) return { skipped: "brand-gone" };
      // Already verified this brand? Don't nag.
      const { count } = await admin
        .from("runs")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", brandId)
        .eq("kind", "verify")
        .neq("status", "failed");
      if ((count ?? 0) > 0) return { skipped: "already-verified" };

      await sendEmail({
        to: prof.email,
        template: "verify-reminder",
        props: {
          appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
          brand: brand.name,
          brandId: brand.id,
        },
      });
      return { sent: true };
    });
  },
);

// ---------------------------------------------------------------------------
// Scheduled runs (weekly verify + monthly audit). Both run on the LOCAL
// Inngest dev server at $0; they only DISPATCH through createRun (the one path),
// which re-checks every entitlement + cost guard + the kill switch, so an
// ineligible brand is always a no-op even if the coarse filter here lets it by.
// There are no plans: FLAG_SCHEDULED_RUNS is the operator's on switch, and a
// brand qualifies once it has one completed audit.
// ---------------------------------------------------------------------------

/** Load every brand with the facts the schedule helpers need. Defensive about
 *  profiles.timezone (migration 0027 may not be applied in a given env). */
async function loadBrandSchedules(
  admin: ReturnType<typeof createAdminClient>,
): Promise<BrandSchedule[]> {
  const withTz = await admin.from("profiles").select("id,timezone");
  let owners: { id: string; timezone: string | null }[];
  if (withTz.error) {
    // timezone column absent → fall back to UTC for everyone (null timezone).
    const noTz = await admin.from("profiles").select("id");
    owners = (noTz.data ?? []).map((p) => ({ id: p.id as string, timezone: null }));
  } else {
    owners = (withTz.data ?? []).map((p) => ({
      id: p.id as string,
      timezone: (p.timezone as string | null) ?? null,
    }));
  }
  if (!owners.length) return [];

  const tzByUser = new Map(owners.map((p) => [p.id, p.timezone]));
  const userIds = owners.map((p) => p.id);
  const { data: brands } = await admin.from("brands").select("id,user_id").in("user_id", userIds);
  if (!brands?.length) return [];

  const brandIds = brands.map((b) => b.id as string);
  const { data: runs } = await admin
    .from("runs")
    .select("brand_id,kind,status,created_at")
    .in("brand_id", brandIds);

  const lastRunAt = new Map<string, string>();
  const hasDone = new Set<string>();
  for (const r of runs ?? []) {
    const bid = r.brand_id as string;
    const prev = lastRunAt.get(bid);
    if (!prev || new Date(r.created_at as string) > new Date(prev)) {
      lastRunAt.set(bid, r.created_at as string);
    }
    if (r.kind === "audit" && r.status === "done") hasDone.add(bid);
  }

  return brands.map((b) => ({
    brandId: b.id as string,
    userId: b.user_id as string,
    timezone: tzByUser.get(b.user_id as string) ?? null,
    hasDoneAudit: hasDone.has(b.id as string),
    lastRunAt: lastRunAt.get(b.id as string) ?? null,
  }));
}

/** Stagger one brand's dispatch to ~local-09:00 + jitter (durable sleep, not a
 *  busy-wait), then create the run through the one path. */
async function dispatchScheduled(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  step: any,
  b: BrandSchedule,
  kind: CronKind,
  fireInstant: Date,
): Promise<void> {
  const delay = dispatchDelayMs(b, fireInstant);
  await step.sleep(`stagger:${kind}:${b.brandId}`, delay);
  await step.run(`dispatch:${kind}:${b.brandId}`, async () => {
    const res = await createRun({ userId: b.userId, brandId: b.brandId, kind });
    if (res.ok) {
      log.info("cron dispatched run", { cron: kind, brandId: b.brandId, runId: res.runId });
    } else {
      // A refusal here is expected (throttle/kill-switch/24h race) — log, don't fail.
      log.warn("cron dispatch refused", { cron: kind, brandId: b.brandId, reason: res.reason });
    }
    return res;
  });
}

async function runScheduleCron(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  step: any,
  kind: CronKind,
): Promise<{ dispatched: number } | { skipped: string }> {
  if (!flag("scheduledRuns")) {
    log.info("scheduled runs disabled by flag", { cron: kind });
    return { skipped: "flag" };
  }
  // Capture the fire instant in a step so tz math is deterministic across replays.
  const fireIso = await step.run("fire-instant", () => new Date().toISOString());
  const fireInstant = new Date(fireIso);

  const eligible: BrandSchedule[] = await step.run("load-eligible", async () => {
    const admin = createAdminClient();
    const all = await loadBrandSchedules(admin);
    return all.filter((b) => isEligible(b, kind, fireInstant.getTime()));
  });
  log.info("scheduled-run cron eligible brands", { cron: kind, count: eligible.length });

  // Fan out: each brand sleeps its own tz-aware/jittered offset in parallel.
  await Promise.all(eligible.map((b) => dispatchScheduled(step, b, kind, fireInstant)));
  return { dispatched: eligible.length };
}

/** Weekly verify — Monday 09:00 UTC; tz-aware + jittered per brand. */
export const weeklyVerifyCron = inngest.createFunction(
  { id: "weekly-verify-cron", concurrency: { limit: 1 }, triggers: [{ cron: "TZ=UTC 0 9 * * 1" }] },
  async ({ step }) => runScheduleCron(step, "verify"),
);

/** Monthly audit — 1st of month 08:00 UTC; the 24h skip auto-avoids an
 *  overlapping weekly verify. */
export const monthlyAuditCron = inngest.createFunction(
  { id: "monthly-audit-cron", concurrency: { limit: 1 }, triggers: [{ cron: "TZ=UTC 0 8 1 * *" }] },
  async ({ step }) => runScheduleCron(step, "audit"),
);
