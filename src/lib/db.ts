// DbWriter implementation (DB snake_case ↔ TS camelCase
// mapped HERE, once). Used only by Inngest server code via the service role.
import type { SupabaseClient } from "@supabase/supabase-js";
import { redactSecretsInText } from "@saylent/engine/adapters/shared";
import { frozenEngines } from "@saylent/engine/engines";
import { PROFILES } from "@saylent/engine/profiles";
import type { DbWriter } from "@saylent/engine/types";
import {
  buildRunHealth,
  type HealthAnswerInput,
  type HealthCorpusInput,
  type HealthFixInput,
  type HealthVerdictInput,
} from "@saylent/report/run-health-build";
import type { RunHealth } from "@saylent/report/run-health";

/** The message we persist on `runs.error` when a run dies. A provider error can
 *  echo the request back (URL query, Authorization header), so it can carry a
 *  live API key — redact BEFORE truncating, so a half-cut key can never survive
 *  in the column the dashboard renders. */
export function redactRunError(err: unknown, max = 500): string {
  const raw = err instanceof Error ? err.message : "";
  if (!raw) return "unknown error";
  return redactSecretsInText(raw).slice(0, max);
}

// Notification copy builders. PURE (no runtime deps; this file is
// `import type`-only), so the engine and its tests share ONE source of truth
// for the exact title/href each run-lifecycle event produces.
export type NotifyType = "audit_ready" | "verify_ready" | "run_failed";
export interface NotifyNotice {
  type: NotifyType;
  title: string;
  href: string;
}

/** Audit finished → "Your {brand} dossier is ready…" (links to the dossier). */
export function auditReadyNotice(
  runId: string,
  brand: string,
  recommended: number,
  answered: number,
): NotifyNotice {
  return {
    type: "audit_ready",
    title: `Your ${brand} dossier is ready — recommended in ${recommended} of ${answered} answers.`,
    href: `/app/run/${runId}`,
  };
}

/** Verify finished → movement before→after (links to the verify view). */
export function verifyReadyNotice(
  runId: string,
  before: number,
  after: number,
  n: number,
): NotifyNotice {
  return {
    type: "verify_ready",
    title: `Movement measured: ${before}/${n} → ${after}/${n} recommended.`,
    href: `/app/run/${runId}/verify`,
  };
}

/** Run failed → "you were not charged. Retry." (brand dropped when not loaded). */
export function runFailedNotice(runId: string, brand?: string): NotifyNotice {
  return {
    type: "run_failed",
    title: brand
      ? `Your ${brand} run hit a wall — you were not charged. Retry.`
      : `Your run hit a wall — you were not charged. Retry.`,
    href: `/app/run/${runId}`,
  };
}

export function createDbWriter(admin: SupabaseClient, userId: string): DbWriter {
  const throwIf = (error: { message: string } | null, op: string) => {
    if (error) throw new Error(`${op}: ${error.message}`);
  };
  return {
    async setStage(runId, label) {
      // .neq guard: a user-cancelled run (status=failed, "cancelled by you") must
      // never be clobbered back to running by a later stage write (0038 hygiene).
      const { error } = await admin
        .from("runs")
        .update({ stage: label, status: "running" })
        .eq("id", runId)
        .neq("status", "failed");
      throwIf(error, "setStage");
    },
    async saveAnswer(row) {
      const { error } = await admin.from("answers").insert({
        run_id: row.runId,
        user_id: userId,
        qid: row.qid,
        qtype: row.qtype,
        question: row.question,
        engine: row.engine,
        ok: row.ok,
        raw_text: row.raw_text,
        citations: row.citations,
        // Canonical rows arrive pre-judged (voteAnswer) — persist the
        // verdict IN the insert. (Regression 2026-07-22: omitting this shipped a
        // full run with 92 NULL verdicts; saveVerdict is no longer called.)
        verdict: row.verdict ?? null,
        error: row.error ?? null,
        usage: row.usage ?? null,
      });
      throwIf(error, "saveAnswer");
    },
    async saveVerdict(runId, qid, engine, verdict) {
      const { error } = await admin
        .from("answers")
        .update({ verdict })
        .eq("run_id", runId)
        .eq("qid", qid)
        .eq("engine", engine);
      throwIf(error, "saveVerdict");
    },
    async saveCorpusPage(row) {
      // Migration 0035 — the corpus-page row shape carries two extra
      // ENRICHMENT fields buildCorpus now populates. They are additive/nullable; the
      // engine's CorpusPageRow type does not declare them (owned separately), so
      // read them off the enriched shape here. Any transient depth fields (word_count
      // /section_count) are deliberately NOT persisted — they have no column.
      const enriched = row as typeof row & {
        page_date?: string | null;
        contact?: { mailto?: string; form_url?: string; claim_url?: string } | null;
      };
      const { error } = await admin.from("corpus_pages").insert({
        run_id: row.runId,
        user_id: userId,
        url: row.url,
        final_url: row.final_url,
        title: row.title,
        page_type: row.page_type,
        cited_by: row.cited_by,
        cited_for_qids: row.cited_for_qids,
        fetch_status: row.fetch_status,
        brand_present: row.brand_present,
        brand_context: row.brand_context,
        competitors_present: row.competitors_present,
        opportunity: row.opportunity,
        thin: row.thin ?? false, // Crawler v2 — honest SPA/thin flag (migration 0030)
        page_date: enriched.page_date ?? null, // cited page's own date
        contact: enriched.contact ?? null, // outlet contact signals
      });
      throwIf(error, "saveCorpusPage");
    },
    async saveCheck(row) {
      const { error } = await admin.from("domain_checks").insert({
        run_id: row.runId,
        user_id: userId,
        check_name: row.check,
        status: row.status,
        detail: row.detail,
        factor: row.factor ?? null,
      });
      throwIf(error, "saveCheck");
    },
    async saveFix(row) {
      const { error } = await admin.from("fixes").insert({
        run_id: row.runId,
        user_id: userId,
        fix_key: row.fixKey,
        title: row.title,
        factor: row.factor,
        weight: row.weight,
        effort: row.effort,
        time_to_impact: row.timeToImpact,
        engines: row.engines,
        evidence: row.evidence,
        artifact: row.artifact ?? null,
      });
      throwIf(error, "saveFix");
    },
    async finishRun(runId, scores, cost) {
      const { error } = await admin
        .from("runs")
        .update({
          status: "done",
          stage: "done",
          scores,
          est_cost_usd: cost,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
      throwIf(error, "finishRun");
    },
    async failRun(runId, errMsg) {
      const { error } = await admin
        .from("runs")
        .update({ status: "failed", error: errMsg })
        .eq("id", runId);
      throwIf(error, "failRun");
    },
    // Best-effort in-app notification. Upsert on (run_id,type) with
    // ignoreDuplicates so the retryable finish step emits at most one row.
    // CRITICAL: unlike every other writer, notify must NEVER throw — a
    // notification failure must not fail a run. Swallow + log and return.
    async notify(runId, type, title, href) {
      try {
        const { error } = await admin
          .from("notifications")
          .upsert(
            { run_id: runId, user_id: userId, type, title, href },
            { onConflict: "run_id,type", ignoreDuplicates: true },
          );
        if (error) console.error("notify failed", "notify", error);
      } catch (error) {
        console.error("notify failed", "notify", error);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Run-health "birth certificate" (migration 0031, contract src/lib/run-health.ts)
// + the delivered-report snapshot. These are ADMIN quality signals written by the
// Inngest pipeline's final/failure step. CRITICAL: like notify(), none of them may
// EVER throw into the pipeline — a health/snapshot failure must not fail a run.
// Every function here swallows + logs and returns a boolean so the caller can note
// the miss (e.g. snapshot_failed) but keep going.
// ---------------------------------------------------------------------------

/** Persist the assembled RunHealth to runs.health. Best-effort (never throws). */
export async function writeRunHealth(
  admin: SupabaseClient,
  runId: string,
  health: RunHealth,
): Promise<boolean> {
  try {
    const { error } = await admin.from("runs").update({ health }).eq("id", runId);
    if (error) {
      console.error("writeRunHealth failed", runId, error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error("writeRunHealth threw", runId, error);
    return false;
  }
}

/** Persist the delivered-dossier payload to run_snapshots (upsert on run_id so a
 *  step retry is idempotent). Best-effort (never throws). */
export async function writeRunSnapshot(
  admin: SupabaseClient,
  runId: string,
  payload: unknown,
): Promise<boolean> {
  try {
    if (payload == null) return false;
    const { error } = await admin
      .from("run_snapshots")
      .upsert({ run_id: runId, payload }, { onConflict: "run_id" });
    if (error) {
      console.error("writeRunSnapshot failed", runId, error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error("writeRunSnapshot threw", runId, error);
    return false;
  }
}

/** Assemble a RunHealth from the run's persisted rows (answers/fixes/corpus/run/
 *  brand). ONE source of truth used by both the success path (after finishRun, all
 *  rows persisted) and the failure path (whatever exists), plus the admin real-data
 *  validation script. Returns null only if the run row itself can't be read. */
export async function assembleHealthFromDb(
  admin: SupabaseClient,
  runId: string,
  status: "done" | "failed",
): Promise<RunHealth | null> {
  const { data: run, error: re } = await admin
    .from("runs")
    .select("id,kind,profile,brand_id,scores,est_cost_usd,created_at,finished_at")
    .eq("id", runId)
    .single();
  if (re || !run) return null;

  const { data: brand } = await admin
    .from("brands")
    .select("question_set,engines")
    .eq("id", run.brand_id)
    .single();
  const engines = frozenEngines(
    (brand?.question_set as { engines?: string[] } | null) ?? null,
    (brand?.engines as string[] | null) ?? null,
  );

  const { data: answerRows } = await admin
    .from("answers")
    .select("qid,engine,ok,citations,verdict")
    .eq("run_id", runId);
  const answers: HealthAnswerInput[] = (answerRows ?? []).map((a) => {
    const v = a.verdict as Record<string, unknown> | null;
    const verdict: HealthVerdictInput | null = v
      ? {
          brand_present: !!v.brand_present,
          mention_type: String(v.mention_type ?? ""),
          prominence: String(v.prominence ?? ""),
          sentiment: String(v.sentiment ?? ""),
          claims: Array.isArray(v.claims) ? v.claims.length : 0,
          other_brands: Array.isArray(v.other_brands) ? v.other_brands.length : 0,
        }
      : null;
    return {
      qid: String(a.qid),
      engine: String(a.engine),
      ok: !!a.ok,
      citations: Array.isArray(a.citations) ? a.citations.length : 0,
      verdict,
    };
  });

  const { data: fixRows } = await admin
    .from("fixes")
    .select("fix_key,weight,artifact")
    .eq("run_id", runId);
  const fixes: HealthFixInput[] = (fixRows ?? []).map((f) => ({
    fixKey: String(f.fix_key),
    weight: Number(f.weight ?? 0),
    artifact: (f.artifact as string | null) ?? null,
  }));

  const { data: corpusRows } = await admin
    .from("corpus_pages")
    .select("fetch_status,thin")
    .eq("run_id", runId);
  const corpus: HealthCorpusInput[] = (corpusRows ?? []).map((c) => ({
    fetch_status: c.fetch_status === null || c.fetch_status === undefined ? null : Number(c.fetch_status),
    thin: !!c.thin,
  }));

  const profile = run.profile === "smoke" ? "smoke" : "full";
  const overall = (run.scores as { overall?: { answered?: number; recommended?: number; rec_rate?: number | null } } | null)
    ?.overall;
  const created = run.created_at ? new Date(run.created_at as string).getTime() : null;
  const finished = run.finished_at ? new Date(run.finished_at as string).getTime() : Date.now();
  // Never emit a negative duration (fixture-seeded rows can have finished_at <
  // created_at); report null when the clock disagrees rather than a nonsense value.
  const durationS = created != null && finished >= created ? Math.round((finished - created) / 1000) : null;

  return buildRunHealth({
    status,
    isAudit: run.kind === "audit",
    engines,
    answers,
    fixes,
    draftTop: PROFILES[profile].draftTop,
    corpus,
    scores: overall
      ? {
          answered: overall.answered ?? 0,
          recommended: overall.recommended ?? 0,
          rec_rate: overall.rec_rate ?? null,
        }
      : null,
    estCostUsd: run.est_cost_usd === null || run.est_cost_usd === undefined ? null : Number(run.est_cost_usd),
    durationS,
  });
}

// ---------------------------------------------------------------------------
// Structural writers (migrations 0032–0034). Standalone (admin + userId
// passed) like writeRunHealth/writeRunSnapshot above — NOT methods on the
// engine-owned DbWriter interface (src/engine/types.ts). The engine code, which
// constructs createDbWriter(admin, userId), holds both admin and userId at that
// call site and invokes these directly. Provided here; called from nowhere in
// this change.
// ---------------------------------------------------------------------------

/** One flattened citation row for the `citations` table (0032). The caller
 *  derives url/normUrl/host via src/lib/citation-url.ts. */
export interface CitationInsert {
  runId: string;
  brandId: string;
  qid: string;
  engine: string;
  url: string;
  normUrl: string;
  host: string;
  position: number | null;
}

/** Insert the flattened citation projection for a run (0032). THROWS on error
 *  like saveAnswer (core evidence, not telemetry) — the caller owns the Inngest
 *  step / retry framing. No-op on an empty list. */
export async function saveCitations(
  admin: SupabaseClient,
  userId: string,
  rows: CitationInsert[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await admin.from("citations").insert(
    rows.map((r) => ({
      run_id: r.runId,
      user_id: userId,
      brand_id: r.brandId,
      qid: r.qid,
      engine: r.engine,
      url: r.url,
      norm_url: r.normUrl,
      host: r.host,
      position: r.position,
    })),
  );
  if (error) throw new Error(`saveCitations: ${error.message}`);
}

/** One per-sample evidence row for `answer_samples` (0033) — a single draw behind
 *  the canonical answers row. citations/verdict/usage carry the same jsonb shapes
 *  as the answers columns. */
export interface AnswerSampleInsert {
  runId: string;
  qid: string;
  engine: string;
  sampleIdx: number;
  raw_text: string;
  citations: unknown;
  verdict?: unknown;
  usage?: unknown;
}

/** Insert the per-sample evidence draws for a run (0033). THROWS on error like
 *  saveAnswer — this is the only copy of the per-sample variance; the caller owns
 *  step/retry framing. No-op on an empty list. */
export async function saveAnswerSamples(
  admin: SupabaseClient,
  userId: string,
  rows: AnswerSampleInsert[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await admin.from("answer_samples").insert(
    rows.map((r) => ({
      run_id: r.runId,
      user_id: userId,
      qid: r.qid,
      engine: r.engine,
      sample_idx: r.sampleIdx,
      raw_text: r.raw_text,
      citations: r.citations ?? [],
      verdict: r.verdict ?? null,
      usage: r.usage ?? null,
    })),
  );
  if (error) throw new Error(`saveAnswerSamples: ${error.message}`);
}

/** Stamp a run's reproducibility snapshot columns (0034 question_set/brand_model,
 *  0041 models/template_set_version). PARTIAL: updates only the fields provided, so
 *  createRun can stamp question_set, the pipeline brand-model step can stamp
 *  brand_model, and the finish step (functions.ts, after runAuditPipeline returns
 *  its RunResult) can stamp models/templateSetVersion — all independently. Best-
 *  effort — like writeRunSnapshot it NEVER throws into the pipeline (a missing
 *  reproducibility snapshot degrades history; it must not fail a run). Returns
 *  success. templateSetVersion is stored as text (0041 column) so a future
 *  non-numeric template-set scheme never needs a migration. */
export async function stampRunSnapshot(
  admin: SupabaseClient,
  runId: string,
  snap: {
    questionSet?: unknown;
    brandModel?: unknown;
    models?: Record<string, string>;
    templateSetVersion?: number | string;
  },
): Promise<boolean> {
  try {
    const patch: Record<string, unknown> = {};
    if (snap.questionSet !== undefined) patch.question_set = snap.questionSet;
    if (snap.brandModel !== undefined) patch.brand_model = snap.brandModel;
    if (snap.models !== undefined) patch.models = snap.models;
    if (snap.templateSetVersion !== undefined) {
      patch.template_set_version = String(snap.templateSetVersion);
    }
    if (Object.keys(patch).length === 0) return false;
    const { error } = await admin.from("runs").update(patch).eq("id", runId);
    if (error) {
      console.error("stampRunSnapshot failed", runId, error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error("stampRunSnapshot threw", runId, error);
    return false;
  }
}
