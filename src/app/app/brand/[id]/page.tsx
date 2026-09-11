// The BRAND page. Movement — "is it working?", honestly — is its main section,
// but it is not the page's identity: a brand with no runs used to land on a page
// titled "{Brand} · movement" whose whole body was "Movement needs a completed
// audit first.". The title is now the brand; a brand with no runs
// gets the run set-up, which is what it actually needs.
// Dots per run · ±1-answer noise ribbon · three-state verdict · rim events
// (fix shipped, engine-set change, re-baseline line-break) · per-engine small
// multiples · SOV emphasis chart · table fallback. Reads existing tables under
// the user's RLS session; smoke and full runs are never mixed in one series.
import { notFound } from "next/navigation";
import { PendingLink } from "@/components/pending-link";
import { diffRuns } from "@saylent/report/answer-diff";
import {
  comparableCohort,
  computeFollowing,
  type FollowingAnswerRow,
  type FollowingView,
} from "@saylent/report/following";
import {
  comparableRunIds,
  pickComparablePair,
  pulseView,
  validateChosenPair,
  type PulseView,
} from "@saylent/report/pulse";
import { partitionByHidden } from "@saylent/report/hygiene";
import { sovEntries } from "@saylent/report/sov";
import {
  deltaState,
  engineSeries,
  runEvents,
  trendSeries,
  type RunEvent,
  type TrendRun,
} from "@saylent/report/trend";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@saylent/report/ui/badge";
import { Button } from "@saylent/report/ui/button";
import { EnginePanel, MovementChart, SovChart } from "./charts";
import { FollowingPanel } from "./following-panel";
import { PulsePanel } from "./pulse-panel";
import { PulseComparePicker, type PickerOption } from "./pulse-compare-picker";
import { RunRowActions } from "./run-row-actions";

export const metadata = { title: "Brand · Saylent" };

const ENGINES = ["chatgpt", "claude", "gemini", "perplexity"] as const;

// Deterministic, timezone-stable run label for the picker (UTC methods so the
// server-rendered <option> text matches on the client — no hydration drift).
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function runLabel(r: { created_at: string; kind: string; profile: string }): string {
  const d = new Date(r.created_at);
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
  return `${date} · ${r.kind} · ${r.profile}`;
}

export default async function MovementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ a?: string | string[]; b?: string | string[] }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const chosenA = Array.isArray(sp.a) ? sp.a[0] : sp.a;
  const chosenB = Array.isArray(sp.b) ? sp.b[0] : sp.b;
  const supabase = await createClient();

  const { data: brand, error: brandError } = await supabase
    .from("brands")
    .select("id,name,domain,aliases")
    .eq("id", id)
    .is("deleted_at", null) // a soft-deleted brand (migration 0038) reads as 404
    .maybeSingle();
  // maybeSingle + explicit split: a genuine missing brand is a 404, but a DB
  // error must reach the error boundary rather than masquerade as notFound().
  if (brandError) throw brandError;
  if (!brand) notFound();

  const { data: runsData, error: runsError } = await supabase
    .from("runs")
    .select("id,kind,status,profile,created_at,scores,hidden_at")
    .eq("brand_id", id)
    .order("created_at", { ascending: true });
  // A read failure is NOT "no runs yet" — throw so we never show "run an audit"
  // over a real error.
  if (runsError) throw runsError;
  // Hidden runs (migration 0038) are split OUT here so EVERY downstream computation —
  // trend series, the Pulse pair, the Living-Asset cohort, per-engine, SOV, run history —
  // sees only visible runs. Hidden runs get their own small drawer below, still reachable.
  const allRuns = (runsData ?? []) as (TrendRun & {
    id: string;
    hidden_at?: string | null;
    scores: { share_of_voice?: Record<string, number> } & TrendRun["scores"];
  })[];
  const { visible: runs, hidden: hiddenRuns } = partitionByHidden(allRuns);
  const doneRuns = runs.filter((r) => r.status === "done");

  const series = trendSeries(runs);
  const { state } = deltaState(series);

  // ---- events: re-baseline (question-set hash) + engine-set changes + fixes shipped
  const { data: hashRows } = doneRuns.length
    ? await supabase
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

  // ---- THE PULSE: the two most-recent COMPARABLE runs (same profile + same
  // frozen question set) diffed sentence-by-sentence. Reuses qByRun (already
  // fetched above) to build the per-run question key pickComparablePair needs;
  // a single-run brand — or two incomparable runs — yields no pair, no panel.
  const questionKeyByRun: Record<string, string> = {};
  for (const r of doneRuns) questionKeyByRun[r.id] = (qByRun.get(r.id) ?? []).sort().join("|");
  // Default = today's auto-pair (the two most-recent comparable runs). The picker
  // is an override via ?a=&b=: validate the chosen pair with the SAME honesty
  // predicate; on any incomparable / unknown choice, fall back with an honest note.
  // audited brand's own aliases — shared by the Pulse diff and the Living-Asset
  // panel (which uses them to never list the brand as its own rival).
  const brandAliases: string[] = brand.aliases?.length ? brand.aliases : [brand.name];
  const autoPair = pickComparablePair(doneRuns, questionKeyByRun);
  let pulsePair = autoPair;
  let pulseNote: string | null = null;
  if (chosenA || chosenB) {
    const chosen = validateChosenPair(chosenA, chosenB, doneRuns, questionKeyByRun);
    if (chosen) {
      pulsePair = chosen;
    } else {
      pulseNote =
        "Those two runs can't be compared honestly: different question set or run profile. Showing the latest comparable pair instead.";
    }
  }
  // Runs offerable in the picker (each has at least one honest partner), newest first.
  const pickerIds = comparableRunIds(doneRuns, questionKeyByRun);
  const pickerById = new Map(doneRuns.map((r) => [r.id, r]));
  const pickerOptions: PickerOption[] = pickerIds.flatMap((rid) => {
    const r = pickerById.get(rid);
    return r ? [{ id: r.id, label: runLabel(r) }] : [];
  });
  const isOverride = !!pulsePair && pulsePair !== autoPair;
  let pulseData: { view: PulseView; questionCount: number; currentRunId: string } | null = null;
  if (pulsePair) {
    // one additional targeted select — raw answer text for ONLY the two paired runs
    const { data: pairAnswers } = await supabase
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
    const diffs = diffRuns(baseAns.map(toInput), currAns.map(toInput), brandAliases);
    // paired = answers present in BOTH runs by (engine,qid); questions = distinct qids
    const baseKeys = new Set(baseAns.map((a) => `${a.engine}:${a.qid}`));
    const pairedAns = currAns.filter((a) => baseKeys.has(`${a.engine}:${a.qid}`));
    const questionCount = new Set(pairedAns.map((a) => a.qid)).size;
    const view = pulseView(diffs, { pairedCount: pairedAns.length, cardCap: 6 });
    pulseData = { view, questionCount, currentRunId: pulsePair.currentRunId };
  }

  // ---- WHAT'S FOLLOWING YOU (Living-Asset panel): rivals + objection themes
  // that PERSIST across the brand's comparable audit cohort (same profile + same
  // frozen question set — the exact honesty rule the Pulse uses). Needs ≥2
  // comparable audits; otherwise the panel is absent entirely (no teaser). One
  // targeted select of only the two verdict jsonb slices, for cohort runs only —
  // no N+1, no over-fetch.
  const followingCohort = comparableCohort(doneRuns, questionKeyByRun);
  let followingView: FollowingView | null = null;
  if (followingCohort.length >= 2) {
    const { data: followRows } = await supabase
      .from("answers")
      .select("run_id,claims:verdict->claims,other_brands:verdict->other_brands")
      .in("run_id", followingCohort);
    followingView = computeFollowing(
      doneRuns,
      questionKeyByRun,
      (followRows ?? []) as FollowingAnswerRow[],
      brandAliases,
    );
  }

  const { data: shippedFixes } = await supabase
    .from("fixes")
    .select("title,published_at,run_id")
    .not("published_at", "is", null)
    .in("run_id", doneRuns.map((r) => r.id));
  // a shipped fix pins to the first run at/after its ship date (rim marker slot)
  const shipEvents: RunEvent[] = (shippedFixes ?? []).flatMap((f) => {
    const at = doneRuns.find((r) => r.created_at >= f.published_at!) ?? doneRuns[doneRuns.length - 1];
    if (!at) return [];
    return [
      {
        run_id: at.id,
        t: at.created_at,
        type: "fix" as const, // shipped-fix rim marker (distinct from engine_set so keys can't collide)
        label: `fix shipped: ${f.title.slice(0, 80)}`,
      },
    ];
  });
  const events = [...comparabilityEvents, ...shipEvents];

  // ---- SOV series: brand + top-3 rivals of the latest run
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
          : { text: "~ within noise, no clear change", cls: "bg-muted text-wire" };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl">{brand.name}</h1>
          <p className="font-mono text-xs text-wire">{brand.domain}</p>
          {/* The third compare job: you vs a specific rival, receipted
              from the latest audit (the /vs page self-handles the no-run state). */}
          <div className="mt-1 flex flex-wrap items-center gap-4">
            <PendingLink
              href={`/app/compare?brand=${id}`}
              className="w-fit font-mono text-xs text-signal underline underline-offset-2 hover:text-ink"
            >
              Compare with a rival →
            </PendingLink>
            {/* T3 App/CLI parity: the questions and run controls, before spending. */}
            <PendingLink
              href={`/app/brand/${id}/questions`}
              className="w-fit font-mono text-xs text-signal underline underline-offset-2 hover:text-ink"
            >
              Questions and run options →
            </PendingLink>
          </div>
        </div>
        <span className={`rounded px-2 py-1 font-mono text-xs ${verdictBadge.cls}`}>
          {verdictBadge.text}
        </span>
      </div>

      {series.length === 0 ? (
        // No runs yet: the page IS the set-up. Both links go where the work is —
        // the questions tab (see and price the set) and the confirm flow.
        <div className="flex flex-col gap-4 rounded-lg border border-line bg-card p-8">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-lg text-ink">Set up your first audit</h2>
            <p className="max-w-[60ch] text-sm text-wire">
              Nothing has been asked about {brand.name} yet. The audit puts your buyers&apos;
              real questions to ChatGPT, Claude, Gemini and Perplexity and stores every answer.
              Check the questions and the price before you spend anything.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild>
              <PendingLink href={`/app/brand/${id}/confirm`}>Review the questions →</PendingLink>
            </Button>
            <Button asChild variant="outline">
              <PendingLink href={`/app/brand/${id}/questions`}>
                Questions and run options
              </PendingLink>
            </Button>
          </div>
          <p className="border-t border-line pt-4 text-sm text-wire">
            Movement — how your recommendation rate changes run over run — appears here once
            this brand has a completed audit.
          </p>
        </div>
      ) : series.length === 1 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-card py-16 text-center">
          <p className="text-wire">
            Movement needs two points. Run a verify (same frozen questions) to get your first
            honest comparison.
          </p>
          <Button asChild variant="outline">
            <PendingLink href="/app">Back to brands &amp; runs</PendingLink>
          </Button>
        </div>
      ) : (
        <>
          <section>
            <p className="font-mono text-xs uppercase tracking-wider text-wire">Movement</p>
            <h2 className="font-display text-lg">Are the engines recommending you more?</h2>
            <p className="mb-2 text-sm text-wire">
              Each dot is one run. Movement inside the gray band (±1 answer) can be luck. We
              only call a trend when it clears the band.
            </p>
            <div className="rounded-lg border border-line bg-card p-4">
              <MovementChart points={series} events={events} seriesLabel="recommended" />
            </div>
          </section>

          {pulseData && pulsePair && (
            <div className="flex flex-col gap-5">
              {pickerOptions.length >= 2 && (
                <PulseComparePicker
                  options={pickerOptions}
                  baselineRunId={pulsePair.baselineRunId}
                  currentRunId={pulsePair.currentRunId}
                  note={pulseNote}
                  brandId={id}
                  isOverride={isOverride}
                />
              )}
              <PulsePanel
                view={pulseData.view}
                questionCount={pulseData.questionCount}
                currentRunId={pulseData.currentRunId}
              />
            </div>
          )}

          {followingView && <FollowingPanel view={followingView} />}

          <section>
            <h2 className="font-display text-lg">Per engine</h2>
            <p className="mb-2 text-sm text-wire">
              The engines disagree. That&apos;s the finding. Gray lines are the other engines for
              context.
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
                You in orange; your top rivals in gray. Counts of mentions across all scored
                answers.
              </p>
              <div className="rounded-lg border border-line bg-card p-4">
                <SovChart series={sovSeries} brandName={brand.name} />
              </div>
            </section>
          )}

          {events.length > 0 && (
            <section>
              <h2 className="font-display text-lg">What changed between runs</h2>
              <ul className="mt-2 flex flex-col gap-1">
                {events
                  .sort((a, b) => a.t.localeCompare(b.t))
                  .map((e, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="font-mono text-xs text-wire" suppressHydrationWarning>
                        {new Date(e.t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                      </span>
                      <span className={e.type === "rebaseline" ? "text-pill-dismissed" : "text-wire"}>
                        {e.label}
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          )}

          <p className="font-mono text-xs text-wire">
            Smoke (dev) runs are excluded when your latest run is a full audit; series never mix
            question-set versions or run profiles. Every number above opens its receipt in the
            run&apos;s report.
          </p>
        </>
      )}

      {/* RUN HISTORY — every run for this brand (all kinds + profiles), newest
          first. Shown independently of the trend gates above so a single run,
          or a brand with only failed/smoke runs, still has an honest ledger.
          Runs are append-only (never deleted); this is the only per-brand list. */}
      {runs.length > 0 && (
        <section>
          <h2 className="font-display text-lg">Run history</h2>
          <p className="mb-2 text-sm text-wire">
            Every audit and verify for {brand.name}, newest first. Runs are never deleted. Each
            row opens its own report.
          </p>
          <div className="overflow-x-auto rounded-lg border border-line bg-card">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-wire">
                  <th className="px-4 py-2 font-normal">Date</th>
                  <th className="py-2 font-normal">Kind</th>
                  <th className="py-2 font-normal">Profile</th>
                  <th className="py-2 text-right font-normal">Recommended</th>
                  <th className="py-2 text-right font-normal">Status</th>
                  <th className="py-2 pr-4 text-right font-normal">Data</th>
                </tr>
              </thead>
              <tbody>
                {[...runs].reverse().map((r) => {
                  const o = r.scores?.overall;
                  const scored = o && o.answered > 0 ? o : null;
                  // finished verifies live at their comparison view; /app/run/[id]
                  // redirects them there anyway, but link direct to skip the hop.
                  const href =
                    r.kind === "verify" && r.status === "done"
                      ? `/app/run/${r.id}/verify`
                      : `/app/run/${r.id}`;
                  return (
                    <tr key={r.id} className="border-b border-line last:border-0 hover:bg-paper">
                      <td className="px-4 py-3 font-mono text-xs text-wire" suppressHydrationWarning>
                        <PendingLink href={href} className="hover:text-ink">
                          {new Date(r.created_at).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "2-digit",
                          })}
                        </PendingLink>
                      </td>
                      <td className="py-3">
                        <Badge variant={r.kind === "verify" ? "outline" : "default"}>
                          {r.kind}
                        </Badge>
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
                      <td className="py-3 text-right">
                        <span
                          className={
                            r.status === "done"
                              ? "text-success"
                              : r.status === "failed"
                                ? "text-pill-dismissed"
                                : "animate-pulse text-signal"
                          }
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="inline-flex items-center gap-2 whitespace-nowrap">
                          {r.status === "done" && (
                            <>
                              <a
                                href={`/api/runs/${r.id}/export?format=csv`}
                                className="font-mono text-[11px] text-wire underline underline-offset-2 hover:text-ink"
                              >
                                CSV
                              </a>
                              <a
                                href={`/api/runs/${r.id}/export?format=json`}
                                className="font-mono text-[11px] text-wire underline underline-offset-2 hover:text-ink"
                              >
                                JSON
                              </a>
                            </>
                          )}
                          <RunRowActions runId={r.id} hidden={false} />
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

      {/* HIDDEN RUNS — kept out of the trend + history above, still reachable and
          restorable (migration 0038). Only rendered when the brand has any. */}
      {hiddenRuns.length > 0 && (
        <section>
          <h2 className="font-display text-lg">Hidden runs</h2>
          <p className="mb-2 text-sm text-wire">
            Hidden from your dashboards, trend and cohorts. Still yours, still reachable. Unhide to
            bring one back into the picture.
          </p>
          <div className="overflow-x-auto rounded-lg border border-line bg-card">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-wire">
                  <th className="px-4 py-2 font-normal">Date</th>
                  <th className="py-2 font-normal">Kind</th>
                  <th className="py-2 font-normal">Status</th>
                  <th className="py-2 pr-4 text-right font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...hiddenRuns].reverse().map((r) => {
                  const href =
                    r.kind === "verify" && r.status === "done"
                      ? `/app/run/${r.id}/verify`
                      : `/app/run/${r.id}`;
                  return (
                    <tr key={r.id} className="border-b border-line last:border-0 hover:bg-paper">
                      <td className="px-4 py-3 font-mono text-xs text-wire" suppressHydrationWarning>
                        <PendingLink href={href} className="hover:text-ink">
                          {new Date(r.created_at).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "2-digit",
                          })}
                        </PendingLink>
                      </td>
                      <td className="py-3">
                        <Badge variant={r.kind === "verify" ? "outline" : "default"}>{r.kind}</Badge>
                      </td>
                      <td className="py-3 font-mono text-xs text-wire">{r.status}</td>
                      <td className="py-3 pr-4 text-right">
                        <RunRowActions runId={r.id} hidden />
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
  );
}
