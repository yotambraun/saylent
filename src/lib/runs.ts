// createRun: THE only run-creation path. Server-only (service role); imported by
// /api/runs and the crons. NOTHING else inserts into runs.
//
// A self-hosted deployment has no plans and no credits, so this path NEVER
// refuses a run over an entitlement. What it does enforce is what actually costs
// the operator money or breaks the methodology: the global kill switch, the
// daily spend ceiling, one active run per brand, and the per-brand rolling
// throttle.
import { inngest } from "@/inngest/client";
import { getAppSettings, setRunsPaused } from "./app-settings";
import type { RunOptions } from "./question-options";
import { assertNotDemo } from "./demo-mode";
import { blockedDomainReason } from "./blocked-domains";
import { stampRunSnapshot } from "./db";
import { spendCeilingExceeded, throttleCap, throttleExceeded, throttleWindowStart } from "./limits";
import { placeholderRefusal } from "./placeholder-guard";
import { createAdminClient } from "./supabase/admin";

export type CreateRunResult = { ok: true; runId: string } | { ok: false; reason: string };

/** What one not-yet-finished run is ASSUMED to cost while it is
 *  in flight. `est_cost_usd` is only written when a run finishes (src/lib/db.ts),
 *  so a burst of concurrent starts used to see a spend total of $0 and sail
 *  straight past the daily ceiling; by the time the bill landed, the money was
 *  spent. A queued/running run therefore books its profile's estimate against
 *  today's budget until its real cost replaces it. Deliberately generous: the
 *  ceiling is a brake, and over-counting delays a run while under-counting spends
 *  the operator's money. */
export const RUN_COST_ESTIMATE_USD: Record<"smoke" | "full", number> = {
  smoke: 0.5,
  full: 3,
};

/** A run row as the ceiling sees it. */
export type SpendRow = {
  est_cost_usd?: number | string | null;
  status?: string | null;
  profile?: string | null;
};

/** Today's spend INCLUDING work already committed to but not yet billed. Pure —
 *  the DB selects the rows, this only adds them up. A run that has already
 *  recorded a cost counts at that cost whatever its status; a queued/running run
 *  with no cost yet counts at its profile estimate. */
export function projectedSpendUsd(rows: SpendRow[]): number {
  return rows.reduce((sum, r) => {
    const realized = Number(r.est_cost_usd ?? 0);
    if (Number.isFinite(realized) && realized > 0) return sum + realized;
    const inFlight = r.status === "queued" || r.status === "running";
    if (!inFlight) return sum;
    return sum + RUN_COST_ESTIMATE_USD[r.profile === "smoke" ? "smoke" : "full"];
  }, 0);
}

/** UTC midnight — the start of the ceiling's day. */
function dayStartIso(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * The operator's budget guard: the global kill switch and the daily spend
 * ceiling. Extracted because `retryRun` re-dispatches a run — a real provider
 * spend — and used to skip both: a user with a failed run could
 * keep pressing Retry after the ceiling had tripped the kill switch and every
 * press cost money.
 */
async function budgetGuard(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ ok: false; reason: string } | null> {
  const settings = await getAppSettings();
  if (settings.runsPaused) {
    return {
      ok: false,
      reason: "Runs are temporarily paused while we check capacity — please try again shortly.",
    };
  }
  const { data: todayRuns } = await admin
    .from("runs")
    .select("est_cost_usd,status,profile")
    .gte("created_at", dayStartIso());
  const todaySpend = projectedSpendUsd((todayRuns ?? []) as SpendRow[]);
  if (spendCeilingExceeded(todaySpend, settings.dailySpendCapUsd)) {
    await setRunsPaused(true);
    // TODO(email): alert the operator — the daily spend ceiling tripped
    // the kill switch (runs auto-paused).
    return {
      ok: false,
      reason:
        "Runs are temporarily paused — the daily spend ceiling was reached. We'll re-enable shortly.",
    };
  }
  return null;
}

/** The per-brand rolling-window throttle on manual runs. Counts every run of this
 *  kind started in the window, any status, so a burst of failures can't be used to
 *  spin the pipeline — which is exactly why a retry has to pass it too (#7). */
async function throttleGuard(
  admin: ReturnType<typeof createAdminClient>,
  brandId: string,
  kind: "audit" | "verify",
): Promise<{ ok: false; reason: string } | null> {
  const { count } = await admin
    .from("runs")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brandId)
    .eq("kind", kind)
    .gte("created_at", throttleWindowStart());
  if (throttleExceeded(kind, count ?? 0)) {
    return {
      ok: false,
      reason: `You've hit the limit of ${throttleCap(kind)} ${kind}s for this brand in the last day — please try again later.`,
    };
  }
  return null;
}

/** Today's deployment-wide budget position, for the two screens that ask a user
 *  to spend it (/app/brand/[id]/questions and .../confirm). Nothing here is a
 *  secret — Settings › Limits already prints the cap — but the SUM needs the
 *  service role, because a user can only see their own runs under RLS and the
 *  ceiling is shared. `remainingUsd` is null when the operator set no cap. */
export async function budgetToday(): Promise<{
  capUsd: number;
  spentUsd: number;
  remainingUsd: number | null;
}> {
  const settings = await getAppSettings();
  const admin = createAdminClient();
  const { data } = await admin
    .from("runs")
    .select("est_cost_usd,status,profile")
    .gte("created_at", dayStartIso());
  const spentUsd = projectedSpendUsd((data ?? []) as SpendRow[]);
  const capUsd = settings.dailySpendCapUsd;
  return {
    capUsd,
    spentUsd,
    remainingUsd: capUsd > 0 ? Math.max(0, capUsd - spentUsd) : null,
  };
}

/** Hard guard: a real user must NEVER silently get a 6-question smoke run. Smoke
 *  is permitted ONLY when the env explicitly asks for it AND this is not a
 *  production deployment — a stray AUDIT_PROFILE=smoke in a production env can
 *  therefore never downgrade somebody's audit. Pure + hard-coded so the guard is
 *  a tested code path, not a convention. */
export function resolveRunProfile(p: {
  /** process.env.AUDIT_PROFILE === "smoke" */
  wantsSmoke: boolean;
  /** process.env.VERCEL_ENV === "production" */
  isProduction: boolean;
}): "smoke" | "full" {
  if (!p.wantsSmoke) return "full";
  if (p.isProduction) return "full";
  return "smoke";
}

export async function createRun(p: {
  userId: string;
  brandId: string;
  kind: "audit" | "verify";
  /** T3 App/CLI parity: the run controls to use for this run. Omit it and
   *  createRun falls back to the draft stored on the brand
   *  (brands.run_options), so every audit path honours the owner's choices.
   *  What it holds: the run controls the owner chose on
   *  /app/brand/<id>/questions (edited questions, samples, engines, locale,
   *  skipped stages). Stamped onto the run row as its receipt and read back by
   *  src/inngest/functions.ts when it builds RunAuditInput — the same thing the
   *  CLI does with its flags. Ignored for kind="verify": a verify must re-ask
   *  the frozen baseline exactly, or it is not a comparison.
   *  Already validated by the caller (question-options.ts normalizeRunOptions);
   *  createRun stores, it does not interpret. */
  runOptions?: RunOptions | null;
}): Promise<CreateRunResult> {
  // Hosted read-only demo: the ONE run-creation path refuses, so a public demo
  // visitor can never spend a cent of provider credit — this guard, not the UI,
  // is what makes the demo $0 per visitor.
  const demo = assertNotDemo();
  if (demo) return demo;

  const admin = createAdminClient();

  // 0) ownership + profile
  const { data: brand } = await admin
    .from("brands")
    .select("id,user_id,domain,category,icp,question_set,run_options")
    .eq("id", p.brandId)
    .eq("user_id", p.userId)
    .maybeSingle();
  if (!brand) return { ok: false, reason: "Brand not found." };

  // 0a) placeholder guard. An AUDIT whose questions would still carry a
  // generation stand-in ("product", "teams evaluating options") is a ~$3 spend
  // on questions no buyer types. A VERIFY is exempt: it re-asks the frozen
  // baseline verbatim or it is not a comparison.
  if (p.kind === "audit") {
    const decided =
      p.runOptions?.questions ??
      (brand.run_options as RunOptions | null)?.questions ??
      (brand.question_set as { questions?: { text?: string }[] } | null)?.questions ??
      [];
    const refusal = placeholderRefusal({
      category: brand.category as string | null,
      icp: brand.icp as string | null,
      questionTexts: decided
        .map((q) => String((q as { text?: string }).text ?? ""))
        .filter(Boolean),
    });
    if (refusal) return { ok: false, reason: refusal };
  }

  // Refuse a re-audit of a domain we've been asked to stop auditing (createBrand
  // gates new brands; this gates re-runs of a brand whose domain was blocked
  // after creation, incl. disable-brand).
  const blocked = await blockedDomainReason(brand.domain as string);
  if (blocked) return { ok: false, reason: blocked };
  // Brand-count is capped at creation (brandLimit in onboarding/actions.ts);
  // no re-check here — a run always targets an already-owned brand.

  // 0b) global kill switch + daily spend ceiling — the operator's real budget
  // guard, and the first thing checked because it applies to everyone. The
  // ceiling counts in-flight runs at their profile estimate (#15).
  const budget = await budgetGuard(admin);
  if (budget) return budget;

  // 1) concurrency: refuse if the brand already has a queued/running run. This
  // is the friendly fast path; the DB partial unique index (migration 0024) is
  // the race-proof authority — see the insert's 23505 handling below.
  const { count: active } = await admin
    .from("runs")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", p.brandId)
    .in("status", ["queued", "running"]);
  if ((active ?? 0) > 0) {
    return { ok: false, reason: "A run is already in progress for this brand." };
  }

  // 1b) per-brand rolling-window throttle on manual runs (audits + verifies
  // capped independently).
  const throttled = await throttleGuard(admin, p.brandId, p.kind);
  if (throttled) return throttled;

  let baselineRunId: string | null = null;

  if (p.kind === "verify") {
    // 2) verify: baseline = latest done audit for the brand. This is the ONLY
    // thing that can refuse a verify — not an entitlement, a missing comparison.
    const { data: baseline } = await admin
      .from("runs")
      .select("id,finished_at,profile")
      .eq("brand_id", p.brandId)
      .eq("kind", "audit")
      .eq("status", "done")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!baseline) return { ok: false, reason: "No completed audit to compare against." };
    baselineRunId = baseline.id;
  }

  // 3) profile stamp: a verify inherits its baseline's profile (a verify must ask
  // the same shape of run it is comparing against); an AUDIT gets 'full' unless
  // the env asks for smoke in a non-production deployment (resolveRunProfile).
  let runProfile: "smoke" | "full" = "full";
  if (p.kind === "verify" && baselineRunId) {
    const { data: b } = await admin.from("runs").select("profile").eq("id", baselineRunId).single();
    runProfile = b?.profile === "smoke" ? "smoke" : "full";
  } else {
    runProfile = resolveRunProfile({
      wantsSmoke: process.env.AUDIT_PROFILE === "smoke",
      isProduction: process.env.VERCEL_ENV === "production",
    });
  }

  // 4) insert the run row. run_options (migration 0043) is the receipt of what
  // this run was told to do — audits only, and never written by a user (0025
  // revoked every user write on runs), so a finished run's receipt is fixed.
  // The draft stored on the brand is authoritative for every audit path: a run
  // started from the dashboard CTA, a cron, or the API must ask what the owner
  // last chose on the questions tab, not the defaults. An explicit blob (the
  // questions tab, which just wrote it) wins, so there is no read-after-write
  // race. A VERIFY takes none of it: it re-asks the frozen baseline.
  const runOptions =
    p.kind === "audit"
      ? (p.runOptions ?? ((brand.run_options as RunOptions | null) ?? null))
      : null;
  const { data: run, error } = await admin
    .from("runs")
    .insert({
      brand_id: p.brandId,
      user_id: p.userId,
      kind: p.kind,
      baseline_run_id: baselineRunId,
      status: "queued",
      profile: runProfile,
      run_options: runOptions,
    })
    .select("id")
    .single();
  if (error || !run) {
    // Race-proof reservation: a concurrent insert lost the partial unique index
    // (migration 0024) — exactly one active run per brand wins, the loser gets
    // the honest concurrency reason instead of a second paid audit.
    if (error?.code === "23505") {
      return { ok: false, reason: "A run is already in progress for this brand." };
    }
    return { ok: false, reason: `Could not create the run: ${error?.message}` };
  }

  // Reproducibility (migration 0034): stamp the FROZEN question envelope this run
  // will ask onto the run itself, when the brand already carries one (verify +
  // re-audit reuse it verbatim). A first audit has no frozen set yet — the
  // pipeline's questions step stamps it right after generating+freezing. Best-effort
  // (stampRunSnapshot never throws — a missing reproducibility snapshot must not
  // fail run creation).
  // An edited draft supplies its own set, so the envelope the brand carries is
  // NOT what this run will ask — the pipeline stamps the real one when it freezes.
  if (brand.question_set && !runOptions?.questions?.length) {
    await stampRunSnapshot(admin, run.id, { questionSet: brand.question_set });
  }

  // 5) emit AFTER the insert commits; send-failure ⇒ honest failed state.
  // userId rides the event so runAudit's per-user concurrency key can isolate
  // one user's queue from another's.
  try {
    await inngest.send({
      name: "audit/run.requested",
      data: { runId: run.id, userId: p.userId },
    });
  } catch {
    await admin.from("runs").update({ status: "failed", error: "dispatch failed" }).eq("id", run.id);
    return { ok: false, reason: "The run could not be dispatched — use Retry." };
  }
  return { ok: true, runId: run.id };
}

/** retryRun — only for status='failed' runs owned by the caller; re-emits the
 *  SAME runId.
 *
 *  A retry creates no row, but it DOES re-run the pipeline, and
 *  that is real provider spend. It used to skip every cost control the operator
 *  has — the kill switch, the daily ceiling, the per-brand throttle — so a failed
 *  run was an unlimited, un-pausable spend button. It now passes the same guards
 *  as createRun. (It keeps its own concurrency rule: the row already exists and
 *  goes back to 'queued', which the migration-0024 partial unique index still
 *  holds to one active run per brand.) */
export async function retryRun(userId: string, runId: string): Promise<CreateRunResult> {
  // Hosted read-only demo — a retry re-dispatches a run, so it is a write + a
  // spend. Refused for the same reason as createRun.
  const demo = assertNotDemo();
  if (demo) return demo;

  const admin = createAdminClient();
  const { data: run } = await admin
    .from("runs")
    .select("id,status,user_id,brand_id,kind")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!run) return { ok: false, reason: "Run not found." };
  if (run.status !== "failed") return { ok: false, reason: "Only failed runs can be retried." };

  // Same cost controls as createRun — a retry spends exactly as much as a run.
  const budget = await budgetGuard(admin);
  if (budget) return budget;
  const kind = run.kind === "verify" ? "verify" : "audit";
  const throttled = await throttleGuard(admin, run.brand_id as string, kind);
  if (throttled) return throttled;

  await admin.from("runs").update({ status: "queued", error: null }).eq("id", runId);
  try {
    await inngest.send({ name: "audit/run.requested", data: { runId, userId } });
  } catch {
    await admin.from("runs").update({ status: "failed", error: "dispatch failed" }).eq("id", runId);
    return { ok: false, reason: "Dispatch failed again — try once more in a minute." };
  }
  return { ok: true, runId };
}
