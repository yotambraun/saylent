// Operator QC console — view-as extended to the customer's Movement/brand page,
// READ ONLY. Mirrors /admin/view-as/[runId]'s approach (service-role reads via
// createAdminClient, no session minted, no write surfaces, no run-creation CTAs)
// but for the brand's Movement view: the movement chart, the Pulse (default
// auto-paired), per-engine small multiples, share-of-voice, and the run history.
// It reuses the SAME pure trend/pulse/sov libs and the SAME chart components the
// customer sees, so what the operator reads is exactly what the customer got.
// requireAdmin() gates it. Nothing here posts to a server action.
//
// Deliberately dropped vs the live page (honest parity note): the interactive
// PulseComparePicker (a ?a=&b= URL-override control) — this stays the default
// auto-pair only, keeping the surface strictly read-only. The "Run an audit"
// empty-state CTAs are replaced with plain operator text.
import { notFound } from "next/navigation";
import { Badge } from "@saylent/report/ui/badge";
import { EnginePanel, MovementChart, SovChart } from "@/app/app/brand/[id]/charts";
import { FollowingPanel } from "@/app/app/brand/[id]/following-panel";
import { PulsePanel } from "@/app/app/brand/[id]/pulse-panel";
import {
  comparableCohort,
  computeFollowing,
  type FollowingAnswerRow,
  type FollowingView,
} from "@saylent/report/following";
import { diffRuns } from "@saylent/report/answer-diff";
import { pickComparablePair, pulseView, type PulseView } from "@saylent/report/pulse";
import { sovEntries } from "@saylent/report/sov";
import {
  deltaState,
  engineSeries,
  runEvents,
  trendSeries,
  type RunEvent,
  type TrendRun,
} from "@saylent/report/trend";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "View-as brand (read-only) · Operator console · Saylent" };

const ENGINES = ["chatgpt", "claude", "gemini", "perplexity"] as const;

export default async function ViewAsBrandPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  await requireAdmin();
  const { brandId } = await params;
  const admin = createAdminClient();

  const { data: brand } = await admin
    .from("brands")
    .select("id,name,domain,aliases,user_id")
    .eq("id", brandId)
    .maybeSingle();
  if (!brand) notFound();

  // owner email for the banner (who we're viewing as)
  let ownerEmail = "unknown";
  if (brand.user_id) {
    const { data: owner } = await admin
      .from("profiles")
      .select("email")
      .eq("id", brand.user_id)
      .maybeSingle();
    if (owner?.email) ownerEmail = owner.email;
  }

  const { data: runsData } = await admin
    .from("runs")
    .select("id,kind,status,profile,created_at,scores")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: true });
  const runs = (runsData ?? []) as (TrendRun & {
    id: string;
    scores: { share_of_voice?: Record<string, number> } & TrendRun["scores"];
  })[];
  const doneRuns = runs.filter((r) => r.status === "done");

  const series = trendSeries(runs);
  const { state } = deltaState(series);

  // events: re-baseline (question-set hash) + engine-set changes + fixes shipped
  const { data: hashRows } = doneRuns.length
    ? await admin
        .from("answers")
        .select("run_id,qid,question")
        .in("run_id", doneRuns.map((r) => r.id))
    : { data: [] as { run_id: string; qid: string; question: string }[] };
  const qByRun = new Map<string, string[]>();
  for (const a of hashRows ?? []) {
    const list = qByRun.get(a.run_id) ?? [];
    list.push(`${a.qid}:${a.question}`);
    qByRun.set(a.run_id, list);
  }
  const eventInputs = doneRuns.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    engines: ENGINES.filter((e) => (r.scores?.per_engine?.[e]?.answered ?? 0) > 0),
    question_hash: (qByRun.get(r.id) ?? []).sort().join("|"),
  }));
  const comparabilityEvents = runEvents(eventInputs);

  // THE PULSE — default auto-pair only (read-only, no ?a=&b= override control)
  const questionKeyByRun: Record<string, string> = {};
  for (const r of doneRuns) questionKeyByRun[r.id] = (qByRun.get(r.id) ?? []).sort().join("|");
  const pulsePair = pickComparablePair(doneRuns, questionKeyByRun);
  let pulseData: { view: PulseView; questionCount: number; currentRunId: string } | null = null;
  if (pulsePair) {
    const { data: pairAnswers } = await admin
      .from("answers")
      .select("run_id,qid,engine,question,raw_text")
      .in("run_id", [pulsePair.baselineRunId, pulsePair.currentRunId]);
    const pairRows = (pairAnswers ?? []) as {
      run_id: string;
      qid: string;
      engine: string;
      question: string;
      raw_text: string;
    }[];
    const toInput = (a: (typeof pairRows)[number]) => ({
      qid: a.qid,
      engine: a.engine,
      question: a.question,
      raw_text: a.raw_text,
    });
    const baseAns = pairRows.filter((a) => a.run_id === pulsePair.baselineRunId);
    const currAns = pairRows.filter((a) => a.run_id === pulsePair.currentRunId);
    const aliases: string[] = brand.aliases?.length ? brand.aliases : [brand.name];
    const diffs = diffRuns(baseAns.map(toInput), currAns.map(toInput), aliases);
    const baseKeys = new Set(baseAns.map((a) => `${a.engine}:${a.qid}`));
    const pairedAns = currAns.filter((a) => baseKeys.has(`${a.engine}:${a.qid}`));
    const questionCount = new Set(pairedAns.map((a) => a.qid)).size;
    const view = pulseView(diffs, { pairedCount: pairedAns.length, cardCap: 6 });
    pulseData = { view, questionCount, currentRunId: pulsePair.currentRunId };
  }

  // "What's following you" — same computation as the customer page, service-role
  // read, so the operator sees the identical Living-Asset panel the customer sees.
  const followingCohort = comparableCohort(doneRuns, questionKeyByRun);
  let followingView: FollowingView | null = null;
  if (followingCohort.length >= 2) {
    const { data: followRows } = await admin
      .from("answers")
      .select("run_id,claims:verdict->claims,other_brands:verdict->other_brands")
      .in("run_id", followingCohort);
    const aliases: string[] = brand.aliases?.length ? brand.aliases : [brand.name];
    followingView = computeFollowing(
      doneRuns,
      questionKeyByRun,
      (followRows ?? []) as FollowingAnswerRow[],
      aliases,
    );
  }

  const { data: shippedFixes } = doneRuns.length
    ? await admin
        .from("fixes")
        .select("title,published_at,run_id")
        .not("published_at", "is", null)
        .in("run_id", doneRuns.map((r) => r.id))
    : { data: [] as { title: string; published_at: string | null; run_id: string }[] };
  const shipEvents: RunEvent[] = (shippedFixes ?? []).flatMap((f) => {
    const at = doneRuns.find((r) => r.created_at >= f.published_at!) ?? doneRuns[doneRuns.length - 1];
    if (!at) return [];
    return [
      {
        run_id: at.id,
        t: at.created_at,
        type: "fix" as const,
        label: `fix shipped: ${f.title.slice(0, 80)}`,
      },
    ];
  });
  const events = [...comparabilityEvents, ...shipEvents];

  // SOV series: brand + top-3 rivals of the latest run
  const latestSov = sovEntries(doneRuns[doneRuns.length - 1]?.scores?.share_of_voice);
  const entities = [
    brand.name,
    ...latestSov
      .filter(([n]) => n.toLowerCase() !== brand.name.toLowerCase())
      .slice(0, 3)
      .map(([n]) => n),
  ];
  const sovSeries = entities.map((name) => ({
    name,
    points: doneRuns.flatMap((r) => {
      const entry = sovEntries(r.scores?.share_of_voice).find(
        ([n]) => n.toLowerCase() === name.toLowerCase(),
      );
      return entry ? [{ t: r.created_at, count: entry[1] }] : [];
    }),
  }));

  const engineData = ENGINES.map((e) => ({ engine: e, points: engineSeries(runs, e) }));
  const panelYMax = Math.max(1, ...engineData.flatMap((d) => d.points.map((p) => p.answered)));

  const verdictBadge =
    series.length < 3
      ? { text: "not enough runs for a trend yet", cls: "bg-muted text-wire" }
      : state === "up"
        ? { text: "▲ moving up", cls: "bg-success/15 text-success" }
        : state === "down"
          ? { text: "▼ moving down", cls: "bg-pill-dismissed/15 text-pill-dismissed" }
          : { text: "~ within noise: no clear change", cls: "bg-muted text-wire" };

  return (
    <div className="min-h-screen bg-paper">
      <div className="sticky top-0 z-20 border-b border-pill-dismissed/50 bg-pill-dismissed/10 px-4 py-2 text-center font-mono text-xs text-pill-dismissed">
        Viewing {ownerEmail}&apos;s movement for {brand.name}. READ ONLY. Nothing here is saved.
      </div>
      <main className="px-4 py-10">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl">{brand.name} · movement</h1>
              <p className="font-mono text-xs text-wire">{brand.domain}</p>
            </div>
            <span className={`rounded px-2 py-1 font-mono text-xs ${verdictBadge.cls}`}>
              {verdictBadge.text}
            </span>
          </div>

          {series.length === 0 ? (
            <div className="rounded-lg border border-line bg-card py-16 text-center text-wire">
              No completed audit for this brand yet. Nothing to show.
            </div>
          ) : series.length === 1 ? (
            <div className="rounded-lg border border-line bg-card py-16 text-center text-wire">
              One run so far. Movement needs a second comparable run before a trend appears.
            </div>
          ) : (
            <>
              <section>
                <h2 className="font-display text-lg">Are the engines recommending you more?</h2>
                <p className="mb-2 text-sm text-wire">
                  Each dot is one run. Movement inside the gray band (±1 answer) can be luck. A
                  trend is only called when it clears the band.
                </p>
                <div className="rounded-lg border border-line bg-card p-4">
                  <MovementChart points={series} events={events} seriesLabel="recommended" />
                </div>
              </section>

              {pulseData && (
                <PulsePanel
                  view={pulseData.view}
                  questionCount={pulseData.questionCount}
                  currentRunId={pulseData.currentRunId}
                />
              )}

              {followingView && <FollowingPanel view={followingView} />}

              <section>
                <h2 className="font-display text-lg">Per engine</h2>
                <p className="mb-2 text-sm text-wire">
                  The engines disagree. That&apos;s the finding. Gray lines are the other engines
                  for context.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {engineData.map(({ engine, points }) => (
                    <EnginePanel
                      key={engine}
                      engine={engine}
                      focus={points}
                      ghosts={engineData.filter((d) => d.engine !== engine).map((d) => d.points)}
                      yMax={panelYMax}
                    />
                  ))}
                </div>
              </section>

              {sovSeries.some((s) => s.points.length >= 2) && (
                <section>
                  <h2 className="font-display text-lg">Share of voice over time</h2>
                  <p className="mb-2 text-sm text-wire">
                    Brand in orange; top rivals in gray. Counts of mentions across all scored
                    answers.
                  </p>
                  <div className="rounded-lg border border-line bg-card p-4">
                    <SovChart series={sovSeries} brandName={brand.name} />
                  </div>
                </section>
              )}
            </>
          )}

          {/* RUN HISTORY — every run for this brand, newest first (read-only; the
              customer's rows link to their own dossiers, so here they are inert
              labels — the operator uses /admin/runs + view-as to open a dossier). */}
          {runs.length > 0 && (
            <section>
              <h2 className="font-display text-lg">Run history</h2>
              <div className="overflow-x-auto rounded-lg border border-line bg-card">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-wire">
                      <th className="px-4 py-2 font-normal">Date</th>
                      <th className="py-2 font-normal">Kind</th>
                      <th className="py-2 font-normal">Profile</th>
                      <th className="py-2 text-right font-normal">Recommended</th>
                      <th className="py-2 pr-4 text-right font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...runs].reverse().map((r) => {
                      const o = r.scores?.overall;
                      const scored = o && o.answered > 0 ? o : null;
                      return (
                        <tr key={r.id} className="border-b border-line last:border-0 hover:bg-paper">
                          <td className="px-4 py-3 font-mono text-xs text-wire" suppressHydrationWarning>
                            {new Date(r.created_at).toLocaleDateString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              year: "2-digit",
                            })}
                          </td>
                          <td className="py-3">
                            <Badge variant={r.kind === "verify" ? "outline" : "default"}>{r.kind}</Badge>
                          </td>
                          <td className="py-3">
                            {r.profile === "smoke" ? (
                              <Badge variant="outline" className="border-wire text-wire">
                                smoke
                              </Badge>
                            ) : (
                              <span className="font-mono text-xs text-wire">{r.profile}</span>
                            )}
                          </td>
                          <td className="py-3 text-right font-mono tabular-nums">
                            {scored ? `${scored.recommended} of ${scored.answered}` : "—"}
                          </td>
                          <td className="py-3 pr-4 text-right">
                            <span
                              className={
                                r.status === "done"
                                  ? "text-success"
                                  : r.status === "failed"
                                    ? "text-pill-dismissed"
                                    : "text-signal"
                              }
                            >
                              {r.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
