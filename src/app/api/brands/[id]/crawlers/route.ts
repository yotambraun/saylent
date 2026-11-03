// POST /api/brands/[id]/crawlers?name=<file>&gz=1&verify=1 — an access log in,
// its AI-crawler aggregates out (migration 0046).
//
// The body is streamed straight through the engine's parser and aggregator
// (@saylent/engine/crawler-analytics, the same code as `saylent crawlers`): the
// log is never written to disk or to the database, and only the CrawlerReport
// is stored (counts, top pages, problem rows with up to three log lines each,
// client IPs redacted, query strings cut). The newest 12 reports per brand are
// kept. Ownership is checked on the owner's RLS client; the insert uses the
// service client because the browser has no write grant on crawler_reports.
//
// Limits: CRAWLER_UPLOAD_MAX_MB (default 200 MB, counted after decompression is
// NOT applied: it counts the bytes sent). Vercel caps a request body at 4.5 MB,
// so on Vercel upload a gzip of a recent slice, or run `saylent crawlers`
// locally; a Docker or local deployment takes the full limit.
import { Readable, Transform, type TransformCallback } from "node:stream";
import os from "node:os";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { NextResponse } from "next/server";
import { analyzeAccessLogs, type JoinRun } from "@saylent/engine/crawler-analytics";
import { assertNotDemo } from "@/lib/demo-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const KEEP = 12;

function byteLimit(max: number) {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      seen += chunk.length;
      if (seen > max) cb(new Error(`The upload is larger than ${Math.round(max / 1_000_000)} MB. Upload a recent slice, gzip it, or run saylent crawlers locally.`));
      else cb(null, chunk);
    },
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const demo = assertNotDemo();
  if (demo) return NextResponse.json({ error: demo.error }, { status: 403 });
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data: brand } = await supabase.from("brands").select("id,domain").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!brand) return NextResponse.json({ error: "brand not found" }, { status: 404 });
  if (!req.body) return NextResponse.json({ error: "empty upload" }, { status: 400 });

  const url = new URL(req.url);
  const name = (url.searchParams.get("name") ?? "access.log").replace(/[^\w.\- ]+/g, "_").slice(0, 200) || "access.log";
  const gz = url.searchParams.get("gz") === "1";
  const verify = url.searchParams.get("verify") === "1";
  const maxMb = Number(process.env.CRAWLER_UPLOAD_MAX_MB ?? "200");
  const max = (Number.isFinite(maxMb) && maxMb > 0 ? maxMb : 200) * 1_000_000;

  // the brand's newest finished run, for "cited pages no AI crawler fetched"
  let join: JoinRun | null = null;
  const { data: lastRun } = await supabase
    .from("runs")
    .select("id")
    .eq("brand_id", id)
    .eq("status", "done")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastRun) {
    const [{ data: answers }, { data: corpus }] = await Promise.all([
      supabase.from("answers").select("qid,engine,ok,citations").eq("run_id", lastRun.id),
      supabase.from("corpus_pages").select("url,final_url").eq("run_id", lastRun.id),
    ]);
    join = {
      runId: lastRun.id as string,
      brandDomain: brand.domain as string,
      answers: (answers ?? []) as JoinRun["answers"],
      corpus: (corpus ?? []) as JoinRun["corpus"],
    };
  }

  let report;
  try {
    const body = Readable.fromWeb(req.body as unknown as import("node:stream/web").ReadableStream).pipe(byteLimit(max));
    const text = gz ? body.pipe(createGunzip()) : body;
    report = await analyzeAccessLogs(text, {
      verifyIps: verify,
      cacheDir: path.join(os.tmpdir(), "saylent-bot-ips"),
      run: join,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 300) : "could not read the log" }, { status: 400 });
  }
  if (report.totals.parsed === 0) {
    return NextResponse.json(
      { error: "No line was a log format saylent reads (nginx/Apache combined, Vercel log drains, Cloudflare Logpush). Nothing was stored." },
      { status: 422 },
    );
  }
  report.sources = [{ ...(report.sources[0] ?? { lines: report.totals.lines, parsed: report.totals.parsed, skipped: report.totals.unparsed, formats: report.totals.formats }), file: name }];

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("crawler_reports")
    .insert({
      brand_id: id,
      user_id: user.id,
      source_name: name,
      window_from: report.window.from,
      window_to: report.window.to,
      ai_bot_hits: report.totals.aiBotHits,
      ai_errors: report.totals.aiErrors,
      ai_blocked: report.totals.aiBlocked,
      report,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: "Could not store the report. Has migration 0046 been applied?" }, { status: 500 });

  // retention: the newest KEEP per brand
  const { data: older } = await admin
    .from("crawler_reports")
    .select("id")
    .eq("brand_id", id)
    .order("created_at", { ascending: false })
    .range(KEEP, KEEP + 100);
  if (older?.length) await admin.from("crawler_reports").delete().in("id", older.map((r) => r.id as string));

  return NextResponse.json({ ok: true, id: row.id, aiBotHits: report.totals.aiBotHits, parsed: report.totals.parsed });
}
