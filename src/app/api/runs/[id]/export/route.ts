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
import { writeBundle } from "@saylent/engine";
import { createClient } from "@/lib/supabase/server";
import { loadRunBundle } from "@/lib/run-bundle";

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

/** GET …/export?format=bundle — the LOSSLESS run bundle, built by
 *  src/lib/run-bundle.ts (shared with the read-only API). */
async function exportBundle(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const r = await loadRunBundle(supabase, id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const filename = `${slugifyBrand(r.brandName)}-${new Date().toISOString().slice(0, 10)}.run.json`;
  return new NextResponse(writeBundle(r.bundle), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
