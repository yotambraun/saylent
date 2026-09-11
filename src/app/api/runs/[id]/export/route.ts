// Per-run data export: GET /api/runs/[id]/export?format=csv|json|bundle.
// Session-authed, owner-only, done runs only. Ownership is enforced by RLS — every read runs
// on the USER's client (createClient), whose "own runs/answers/fixes/corpus" policies make a
// foreign run's rows invisible, so a non-owner's request simply resolves to "not found". Mirrors
// the auth shape of the share route. Streams a JSON receipt, the flattened answers CSV, or the
// LOSSLESS run bundle (packages/engine/src/bundle.ts) as a download; no temp files. Pure
// serialization lives in @saylent/report/run-export and @saylent/engine/bundle (unit-tested there).
import { NextResponse } from "next/server";
import {
  answerCsvRows,
  buildRunExportJson,
  exportFilename,
  slugifyBrand,
  toCsv,
  CSV_HEADERS,
  type ExportAnswer,
  type ExportCorpusPage,
  type ExportFix,
} from "@saylent/report/run-export";
import {
  bundleFromRows,
  frozenEngines,
  modelsUsed,
  writeBundle,
  TEMPLATE_SET_VERSION,
  type BrandModel,
  type BundleRowsInput,
  type BundleRunMeta,
  type Question,
  type Scores,
} from "@saylent/engine";
import { createClient } from "@/lib/supabase/server";
import { fetchDossierViaRpc } from "@/lib/dossier-data";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const formatParam = new URL(req.url).searchParams.get("format");
  const format = formatParam === "csv" ? "csv" : formatParam === "bundle" ? "bundle" : "json";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (format === "bundle") return exportBundle(supabase, id);

  // RLS scopes this to the caller's own runs — a foreign / missing id returns null.
  const { data: run, error: runError } = await supabase
    .from("runs")
    .select("id,brand_id,kind,status,profile,scores,est_cost_usd,created_at,finished_at")
    .eq("id", id)
    .maybeSingle();
  if (runError) return NextResponse.json({ error: "read failed" }, { status: 500 });
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  if (run.status !== "done") {
    return NextResponse.json({ error: "run is not finished: nothing to export yet" }, { status: 409 });
  }

  const [{ data: brand }, { data: answersData }, { data: fixesData }, { data: corpusData }] =
    await Promise.all([
      supabase.from("brands").select("name,domain").eq("id", run.brand_id).maybeSingle(),
      supabase
        .from("answers")
        .select("qid,question,engine,qtype,verdict,citations")
        .eq("run_id", id)
        .order("qid", { ascending: true }),
      supabase
        .from("fixes")
        .select("fix_key,title,factor,weight,effort,evidence,artifact")
        .eq("run_id", id),
      supabase.from("corpus_pages").select("page_type,cited_by,opportunity").eq("run_id", id),
    ]);

  const answers = (answersData ?? []) as ExportAnswer[];
  const brandName = brand?.name ?? "brand";
  const filename = exportFilename(brandName, new Date(), format);

  if (format === "csv") {
    const csv = toCsv(CSV_HEADERS, answerCsvRows(answers));
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const document = buildRunExportJson({
    run: {
      id: run.id,
      kind: run.kind,
      profile: run.profile,
      status: run.status,
      created_at: run.created_at,
      finished_at: run.finished_at,
      est_cost_usd: run.est_cost_usd,
    },
    brand: { name: brandName, domain: brand?.domain ?? "" },
    scores: run.scores ?? null,
    answers,
    fixes: (fixesData ?? []) as ExportFix[],
    corpus: (corpusData ?? []) as ExportCorpusPage[],
  });

  return new NextResponse(JSON.stringify(document, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

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

/** GET …/export?format=bundle — the LOSSLESS run bundle (packages/engine/src/
 *  bundle.ts RunBundleV1): same shape the CLI writes to run.json, so a report
 *  downloaded from the app can be re-rendered, verified, or imported by the CLI.
 *  Reuses the dossier RPC (fetchDossierViaRpc — same one-round-trip read the
 *  owner page uses) for run/brand/answers/corpus/checks/fixes, then adds the
 *  three reads get_dossier's lean payload (migration 0039) doesn't carry:
 *  runs.question_set (frozen questions + engine set + version — stripped from
 *  the RPC payload), and the flattened `citations` / `answer_samples` tables
 *  (never part of the dossier at all). All plain `.select()`s on the caller's
 *  own RLS-scoped client — no new RPC, no auth change. */
async function exportBundle(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const dossier = await fetchDossierViaRpc(supabase, id);
  if (!dossier || !dossier.brand) return NextResponse.json({ error: "run not found" }, { status: 404 });
  const { run, brand, answers, corpus, checks, fixes } = dossier;
  if (run.status !== "done") {
    return NextResponse.json({ error: "run is not finished: nothing to export yet" }, { status: 409 });
  }

  const [{ data: runRow }, { data: citationsData }, { data: samplesData }] = await Promise.all([
    supabase.from("runs").select("question_set").eq("id", id).maybeSingle(),
    supabase.from("citations").select("qid,engine,url,norm_url,host,position,brand_id").eq("run_id", id),
    supabase
      .from("answer_samples")
      .select("qid,engine,sample_idx,raw_text,citations,verdict,usage")
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

  const bundle = bundleFromRows(rows);
  const filename = `${slugifyBrand(brand.name)}-${new Date().toISOString().slice(0, 10)}.run.json`;

  return new NextResponse(writeBundle(bundle), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
