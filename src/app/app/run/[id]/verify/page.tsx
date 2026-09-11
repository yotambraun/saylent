// /app/run/[id]/verify — the before/after comparison.
// Hero "Recommended {before}/{N} → {after}/{N}"; |Δ|≤1 renders the noise note
// VERBATIM; per-engine table; "Since you shipped" watch notes; eligibility CTA.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { diffAnswer } from "@saylent/report/answer-diff";
import { flag } from "@/lib/flags";
import { createClient } from "@/lib/supabase/server";
import { PerEngineTable, type EngineChange } from "@saylent/report/components/per-engine-table";
import { NextReportHost } from "../host";

export const metadata = { title: "Verify re-run · Saylent" };

const ENGINE_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
};

interface EngineScore {
  answered: number;
  recommended: number;
  mentioned: number;
}
interface ScoresShape {
  per_engine?: Record<string, EngineScore>;
  overall?: EngineScore;
  verify?: {
    baseline: { per_engine?: Record<string, EngineScore>; overall?: EngineScore } | null;
    watch_notes: { fixKey: string; title: string; note: string; newlyPresentQids: string[] }[];
  };
}

interface AnswerRow {
  run_id: string;
  qid: string;
  engine: string;
  question: string;
  raw_text: string;
  verdict: unknown;
}

const ENGINES = ["chatgpt", "claude", "gemini", "perplexity"];

export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: run } = await supabase
    .from("runs")
    .select("id,kind,status,scores,finished_at,brand_id,baseline_run_id")
    .eq("id", id)
    .maybeSingle();
  if (!run) notFound();
  if (run.kind !== "verify") redirect(`/app/run/${id}`);
  if (run.status !== "done") redirect(`/app/run/${id}`);

  const { data: brand } = await supabase
    .from("brands")
    .select("name,domain,aliases")
    .eq("id", run.brand_id)
    .single();
  const aliases: string[] = brand?.aliases?.length
    ? brand.aliases
    : [brand?.name].filter((v): v is string => typeof v === "string");
  const scores = (run.scores ?? {}) as ScoresShape;
  const baseline = scores.verify?.baseline;
  const before = baseline?.overall?.recommended ?? 0;
  const after = scores.overall?.recommended ?? 0;
  const engineCount = Math.max(
    1,
    ENGINES.filter((e) => (scores.per_engine?.[e]?.answered ?? 0) > 0).length,
  );
  const n = Math.round((scores.overall?.answered ?? 0) / engineCount) || 0;
  const delta = Math.abs(after - before);
  const watchNotes = scores.verify?.watch_notes ?? [];

  // Per-answer verdicts for the drill-down: which answers CHANGED mention_type
  // vs the baseline audit. run.scores only carries per-engine AGGREGATES, so we
  // read the raw answers of both runs (this verify run + baseline_run_id) here.
  const answerRunIds = [id, run.baseline_run_id].filter(
    (v): v is string => typeof v === "string",
  );
  const { data: answerRows } = answerRunIds.length
    ? await supabase
        .from("answers")
        .select("run_id,qid,engine,question,raw_text,verdict")
        .in("run_id", answerRunIds)
    : { data: [] as AnswerRow[] };

  // (engine → qid → mention_type) for each run, so we can diff qid-by-qid.
  const mentionOf = (v: unknown) =>
    (v as { mention_type?: string } | null)?.mention_type ?? null;
  const presentOf = (v: unknown) =>
    (v as { brand_present?: boolean } | null)?.brand_present === true;
  const perRun = new Map<string, Map<string, Map<string, string>>>(); // run → engine → qid → mt
  const questionOf = new Map<string, string>(); // `${engine}:${qid}` → question text
  const rawByKey = new Map<string, string>(); // `${run}:${engine}:${qid}` → raw_text
  const currentPresent = new Map<string, Set<string>>(); // qid → engines naming you now
  for (const a of (answerRows ?? []) as AnswerRow[]) {
    rawByKey.set(`${a.run_id}:${a.engine}:${a.qid}`, a.raw_text ?? "");
    if (a.run_id === id && presentOf(a.verdict)) {
      const set = currentPresent.get(a.qid) ?? new Set<string>();
      set.add(a.engine);
      currentPresent.set(a.qid, set);
    }
    const mt = mentionOf(a.verdict);
    if (!mt) continue;
    let byEngine = perRun.get(a.run_id);
    if (!byEngine) perRun.set(a.run_id, (byEngine = new Map()));
    let byQid = byEngine.get(a.engine);
    if (!byQid) byEngine.set(a.engine, (byQid = new Map()));
    byQid.set(a.qid, mt);
    if (a.run_id === id) questionOf.set(`${a.engine}:${a.qid}`, a.question);
  }
  const baseId = run.baseline_run_id ?? "";
  const changesByEngine: Record<string, EngineChange[]> = {};
  for (const e of ENGINES) {
    const now = perRun.get(id)?.get(e);
    const was = perRun.get(baseId)?.get(e);
    if (!now || !was) continue; // need both sides to call something a "change"
    const list: EngineChange[] = [];
    for (const [qid, after_] of now) {
      const before_ = was.get(qid);
      if (before_ && before_ !== after_) {
        const question = questionOf.get(`${e}:${qid}`) ?? qid;
        // Sentence receipt: which whole sentences the engine ADDED / REMOVED for
        // this exact (engine, qid) between baseline and now (answer-diff caps ≤3
        // each). Empty when both raw texts are absent — the row still renders.
        const d = diffAnswer(
          { qid, engine: e, question, raw_text: rawByKey.get(`${baseId}:${e}:${qid}`) ?? "" },
          { qid, engine: e, question, raw_text: rawByKey.get(`${id}:${e}:${qid}`) ?? "" },
          aliases,
        );
        list.push({
          qid,
          question,
          before: before_,
          after: after_,
          entered: d.added,
          departed: d.removed,
        });
      }
    }
    if (list.length) changesByEngine[e] = list.sort((a, b) => a.qid.localeCompare(b.qid));
  }

  // THE WIN — did a shipped fix verifiably move? "Moved" reuses the engine's own
  // score.ts semantics: a watch note whose evidence qids now name the brand where
  // they didn't at baseline (newlyPresentQids > 0) — a categorical new presence,
  // not a ±1 count swing. The single rationed celebration fires
  // once for the FIRST such fix; attributed to one engine only when exactly one
  // engine newly names you across those qids, else the honest generic line.
  const movedNote = watchNotes.find((w) => w.newlyPresentQids.length > 0) ?? null;
  let celebrationLine: string | null = null;
  if (movedNote) {
    const engines = new Set<string>();
    for (const qid of movedNote.newlyPresentQids) {
      for (const e of currentPresent.get(qid) ?? []) engines.add(e);
    }
    const only = engines.size === 1 ? [...engines][0] : null;
    celebrationLine = only
      ? `That fix worked. ${ENGINE_LABEL[only] ?? only} now cites you.`
      : "That fix worked. The answers moved.";
  }

  // Shipped date per fix (en-GB dd MMM yyyy chip): the published fixes are the
  // baseline audit's, mirroring the verify's own watch-note source (functions.ts).
  const { data: shippedFixData } = run.baseline_run_id
    ? await supabase
        .from("fixes")
        .select("fix_key,published_at")
        .eq("run_id", run.baseline_run_id)
        .not("published_at", "is", null)
    : { data: [] as { fix_key: string; published_at: string | null }[] };
  const shippedAtByKey = new Map<string, string>();
  for (const f of (shippedFixData ?? []) as { fix_key: string; published_at: string | null }[]) {
    if (f.published_at) shippedAtByKey.set(f.fix_key, f.published_at);
  }
  const shippedDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
      <a href="/app" className="text-xs text-wire underline">
        ← Brands &amp; runs
      </a>
      <p className="-mt-6 font-mono text-xs uppercase tracking-wider text-wire">
        SAYLENT · VERIFY RE-RUN · {brand?.name} · {brand?.domain} ·{" "}
        {run.finished_at ? new Date(run.finished_at).toLocaleDateString("en-GB") : ""}
      </p>

      {/* THE WIN headline — only when at least one fix was shipped before this
          verify (watchNotes are computed only from published fixes). No shipped
          fixes → the current framing stays. */}
      {watchNotes.length > 0 && (
        <div className="-mb-4 flex flex-col gap-1.5">
          <p className="font-mono text-xs uppercase tracking-widest text-wire">The verify</p>
          <h2 className="font-display text-3xl leading-tight text-ink">
            You shipped. Here&apos;s what moved.
          </h2>
        </div>
      )}

      {/* HERO */}
      <section className="rounded-lg border border-line bg-card p-8 text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-wire">
          Recommended, before → after
        </p>
        <div className="mt-4 flex items-baseline justify-center gap-4 font-display">
          <span className="text-4xl text-wire">
            {before}/{n}
          </span>
          <span className="text-3xl text-signal">→</span>
          <span className={`text-6xl ${after > before ? "text-success" : ""}`}>
            {after}/{n}
          </span>
        </div>
        {delta <= 1 && (
          <>
            <p className="mx-auto mt-4 max-w-md text-sm text-wire">
              A one-answer swing on a {n}-question set is within normal variation. Sustained
              movement across runs is the signal.
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-wire">
              No measurable movement yet. That&apos;s normal inside the stated time-to-impact.{" "}
              {watchNotes.length} of your shipped fixes are being watched; re-verify after the
              window.
            </p>
          </>
        )}
      </section>

      {/* PER-ENGINE */}
      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-mono text-xs uppercase tracking-widest text-wire">Per engine</h2>
          {run.brand_id && (
            <Link
              href={`/app/brand/${run.brand_id}`}
              className="font-mono text-xs text-wire underline hover:text-ink"
            >
              see the full trend →
            </Link>
          )}
        </div>
        {/* the table is a package component now; NextReportHost supplies the
            app's Link so drilling into a changed answer stays a client transition */}
        <NextReportHost>
          <PerEngineTable
            engines={ENGINES}
            rows={ENGINES.map((e) => {
              const b = baseline?.per_engine?.[e];
              const c = scores.per_engine?.[e];
              return {
                engine: e,
                flagged: (c?.answered ?? 0) === 0,
                beforeRecommended: b?.recommended ?? 0,
                afterRecommended: c?.recommended ?? 0,
                beforeMentioned: b?.mentioned ?? 0,
                afterMentioned: c?.mentioned ?? 0,
                changes: changesByEngine[e] ?? [],
              };
            })}
            baselineRunId={run.baseline_run_id}
          />
        </NextReportHost>
      </section>

      {/* SINCE YOU SHIPPED */}
      <section>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-widest text-wire">
          Since you shipped
        </h2>
        {watchNotes.length === 0 ? (
          <p className="text-sm text-wire">
            No fixes were marked as shipped before this verify. Mark fixes as shipped in your
            report and the next verify will watch them individually.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {watchNotes.map((w) => {
              const shippedAt = shippedAtByKey.get(w.fixKey);
              return (
                <li key={w.fixKey} className="rounded-lg border border-line bg-card p-4 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium">{w.title}</p>
                    {shippedAt && (
                      <span className="font-mono text-xs text-wire">
                        ✓ shipped {shippedDate(shippedAt)}
                      </span>
                    )}
                  </div>
                  <p
                    className={`mt-1 ${w.newlyPresentQids.length > 0 ? "text-success" : "text-wire"}`}
                  >
                    {w.note}
                    {w.newlyPresentQids.length > 0 && run.baseline_run_id && (
                      <Link href={`/app/run/${run.id}`} className="ml-2 underline">
                        see the new answers →
                      </Link>
                    )}
                  </p>
                  {/* THE ONE CELEBRATION — rendered at most once, on the first
                      shipped fix that verifiably moved. A signal rule + one serif
                      line, attached to the stat that improved. */}
                  {movedNote && w.fixKey === movedNote.fixKey && celebrationLine && (
                    <div className="mt-3 border-t-2 border-signal pt-3">
                      <p className="font-display text-lg leading-snug text-ink">{celebrationLine}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* CTA */}
      <section className="rounded-lg border border-line bg-card p-6 text-sm">
        {flag("scheduledRuns") ? (
          <p>
            Weekly verifies run automatically every Monday. Movement lands in your inbox.
          </p>
        ) : (
          <p>
            This audit&apos;s verify re-run has been used. Weekly verifies run when your
            operator enables scheduled runs — or run a fresh audit yourself when you ship your
            next round of fixes.
          </p>
        )}
      </section>
    </div>
  );
}
