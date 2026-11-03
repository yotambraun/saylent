import "server-only";
// The lossless run bundle (packages/engine/src/bundle.ts RunBundleV1) for a
// run in the database: the same shape the CLI writes to run.json, so a run
// downloaded from the app can be re-rendered, verified or exported by the CLI.
// Shared by GET /api/runs/[id]/export?format=bundle, the app's Export menu
// and the read-only API (/api/v1). Moved here from the export route
// unchanged, plus the owner check the API's service-client path needs.
import {
  bundleFromRows,
  frozenEngines,
  modelsUsed,
  TEMPLATE_SET_VERSION,
  type BrandModel,
  type BundleRowsInput,
  type BundleRunMeta,
  type Question,
  type RunBundleV1,
  type Scores,
} from "@saylent/engine";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDossierViaRpc } from "./dossier-data";

export type RunBundleResult =
  | { ok: true; bundle: RunBundleV1; brandId: string | null; brandName: string }
  | { ok: false; status: 404 | 409; error: string };

interface RawAnswerRowForQuestions {
  qid: string;
  qtype?: string | null;
  question: string;
}

/** Degraded fallback (mirrors the migration-0034 comment): a run predating the
 *  reproducibility snapshot has no frozen `question_set` — re-derive the question
 *  list from its own answer rows, one per distinct qid, in qid order. This loses
 *  the version + engines envelope (the run row/bundle header still carry the best
 *  values available), never a broken read. */
function questionsFromAnswers(rows: RawAnswerRowForQuestions[]): Question[] {
  const byQid = new Map<string, Question>();
  for (const r of rows) {
    if (!byQid.has(r.qid)) {
      byQid.set(r.qid, {
        qid: r.qid,
        text: r.question,
        qtype: (r.qtype ?? "category") as Question["qtype"],
      });
    }
  }
  return [...byQid.values()].sort((a, b) => a.qid.localeCompare(b.qid));
}

/** The LOSSLESS run bundle (packages/engine/src/
 *  bundle.ts RunBundleV1): same shape the CLI writes to run.json, so a report
 *  downloaded from the app can be re-rendered, verified, or imported by the CLI.
 *  Reuses the dossier RPC (fetchDossierViaRpc — same one-round-trip read the
 *  owner page uses) for run/brand/answers/corpus/checks/fixes, then adds the
 *  three reads get_dossier's lean payload (migration 0039) doesn't carry:
 *  runs.question_set (frozen questions + engine set + version — stripped from
 *  the RPC payload), and the flattened `citations` / `answer_samples` tables
 *  (never part of the dossier at all). All plain `.select()`s on the caller's
 *  own RLS-scoped client — no new RPC, no auth change. */
export async function loadRunBundle(
  supabase: SupabaseClient,
  id: string,
  opts: { ownerId?: string } = {},
): Promise<RunBundleResult> {
  // The service-client path (an API token) has no RLS: check the owner on the
  // run row before anything else is read. The session path is already scoped
  // by RLS, so it skips this read.
  if (opts.ownerId) {
    const { data: owned, error } = await supabase.from("runs").select("id").eq("id", id).eq("user_id", opts.ownerId).maybeSingle();
    if (error || !owned) return { ok: false, status: 404, error: "run not found" };
  }
  const dossier = await fetchDossierViaRpc(supabase, id);
  if (!dossier || !dossier.brand) return { ok: false, status: 404, error: "run not found" };
  const { run, brand, answers, corpus, checks, fixes } = dossier;
  if (run.status !== "done") {
    return { ok: false, status: 409, error: "run is not finished: nothing to export yet" };
  }

  const [{ data: runRow }, { data: citationsData }, { data: samplesData }] = await Promise.all([
    supabase.from("runs").select("question_set").eq("id", id).maybeSingle(),
    supabase.from("citations").select("qid,engine,url,norm_url,host,position,brand_id").eq("run_id", id),
    supabase
      .from("answer_samples")
      // "*" rather than a column list: search_queries (migration 0049) is
      // read when the column exists, and a database without it still loads
      .select("*")
      .eq("run_id", id),
  ]);
  const questionSet = (runRow?.question_set ?? null) as {
    questions?: Question[];
    version?: number;
    engines?: string[];
  } | null;

  const engines = frozenEngines({ engines: questionSet?.engines ?? null }, null);
  const questions: Question[] = questionSet?.questions?.length
    ? questionSet.questions
    : questionsFromAnswers(answers as RawAnswerRowForQuestions[]);

  // runs.brand_model (0034) is the pipeline-built BrandModel snapshot for THIS
  // run; get_dossier's `run` object carries it (only user_id/question_set are
  // stripped, 0039). Older pre-0034 runs have none — fall back to the brand's
  // live basics with the fields the pipeline alone derives left blank.
  const fallbackBrandModel: BrandModel = {
    brand: brand.name,
    domain: brand.domain,
    aliases: brand.aliases ?? [],
    category: "",
    icp: "",
    products: [],
    value_props: [],
    problems: [],
    competitors: brand.competitors ?? [],
    language: "en",
  };
  const brandModel: BrandModel =
    (run as { brand_model?: BrandModel | null }).brand_model ?? fallbackBrandModel;

  // models / template_set_version (migration 0041): the pipeline stamps both onto
  // the run at finish time (functions.ts stamp-run-models step), so get_dossier's
  // `run` object already carries them for any run finished after 0041 shipped —
  // prefer those PERSISTED values (what this run actually used) over recomputing
  // from the current build, which is only correct until a MODEL_* override or the
  // TEMPLATE_SET_VERSION constant changes. Runs finished before 0041 have neither
  // column (NULL) and fall back to the current build's values, same gap that
  // already existed in the schema.
  const persistedModels = (run as { models?: Record<string, string> | null }).models;
  const persistedTemplateVersion = (run as { template_set_version?: string | null })
    .template_set_version;
  const runMeta: BundleRunMeta = {
    id: run.id,
    kind: run.kind as BundleRunMeta["kind"],
    profile: (run as { profile?: string }).profile === "smoke" ? "smoke" : "full",
    status: "done",
    brand: { name: brand.name, domain: brand.domain },
    engines,
    models: persistedModels && Object.keys(persistedModels).length ? persistedModels : modelsUsed(engines),
    template_set_version: persistedTemplateVersion ? Number(persistedTemplateVersion) : TEMPLATE_SET_VERSION,
    question_set_version: questionSet?.version ?? 1,
    started_at: run.created_at,
    finished_at: run.finished_at,
    est_cost_usd: (run as { est_cost_usd?: number | null }).est_cost_usd ?? null,
    baseline_run_id: (run as { baseline_run_id?: string | null }).baseline_run_id ?? null,
    failure: (run as { error?: string | null }).error ?? null,
  };

  const rows: BundleRowsInput = {
    run: runMeta,
    brand_model: brandModel,
    questions,
    answers: answers as unknown as BundleRowsInput["answers"],
    samples: (samplesData ?? []) as unknown as BundleRowsInput["samples"],
    citations: (citationsData ?? []) as unknown as BundleRowsInput["citations"],
    corpus_pages: corpus as unknown as BundleRowsInput["corpus_pages"],
    domain_checks: checks as unknown as BundleRowsInput["domain_checks"],
    fixes: fixes as unknown as BundleRowsInput["fixes"],
    scores: (run.scores ?? null) as Scores | null,
    health: (run as { health?: Record<string, unknown> | null }).health ?? null,
  };

  return {
    ok: true,
    bundle: bundleFromRows(rows),
    brandId: (run as { brand_id?: string | null }).brand_id ?? null,
    brandName: brand.name,
  };
}
