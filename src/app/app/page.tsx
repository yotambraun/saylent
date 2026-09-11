// /app — the dashboard: ALL brands as cards (latest result, status, actions)
// + recent runs across brands. Rebuilt after review caught the
// LIMIT-1 bug that hid every brand except the first.
import Link from "next/link";
import { DeltaBadge } from "@/components/delta-badge";
import { PendingLink } from "@/components/pending-link";
import { ScrollX } from "@/components/scroll-x";
import { Sparkline } from "@/components/sparkline";
import { flag } from "@/lib/flags";
import { createClient } from "@/lib/supabase/server";
import { sovEntries, topRival } from "@saylent/report/sov";
import { trendSeries } from "@saylent/report/trend";
import { Button } from "@saylent/report/ui/button";
import { RecentRuns, type RecentRun } from "./recent-runs";
import { RunCta } from "./run-cta";
import { HomeGreeting } from "./home-greeting";
import { NextMoves, type ActiveRunLite } from "./next-moves";
import { computeNextMoves } from "@saylent/report/next-moves";

export const metadata = { title: "Dashboard · Saylent" };

interface RunLite {
  id: string;
  brand_id: string;
  kind: string;
  status: string;
  stage: string;
  profile: string;
  created_at: string;
  finished_at: string | null;
  baseline_run_id: string | null;
  scores: {
    overall?: { recommended: number; answered: number; rec_rate: number | null };
    share_of_voice?: Record<string, number>;
    verify?: { watch_notes?: { newlyPresentQids?: string[] }[] };
  } | null;
}

const scoredN = (r: RunLite) => {
  const o = r.scores?.overall;
  if (!o || o.answered === 0) return null;
  // answered counts engine-answers; per-question N ≈ answered / engines-with-answers is
  // overkill here — show recommended count against answered engine-answers honestly
  return { rec: o.recommended, answered: o.answered, pct: Math.round((o.rec_rate ?? 0) * 100) };
};

export default async function AppHome() {
  const supabase = await createClient();
  const { data: brands, error: brandsError } = await supabase
    .from("brands")
    .select("id,name,domain")
    // migration 0038 soft-delete: never surface a deleted brand (partial index backs this)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  // A DB error is NOT "no brands" — surface it to the error boundary instead of
  // rendering the onboarding empty state over a real failure.
  if (brandsError) throw brandsError;

  if (!brands || brands.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 py-24 text-center">
        <p className="text-wire">Add your brand and domain. The audit takes about ten minutes.</p>
        <Button asChild>
          <Link href="/app/onboarding">Run your first audit</Link>
        </Button>
        <Link href="/demo" className="text-sm text-wire underline hover:text-ink">
          or read a sample report →
        </Link>
      </div>
    );
  }

  // PERF: runs + profile are independent of each other, so fetch them in
  // ONE Promise.all round-trip instead of two serial awaits. brands had to resolve
  // first (the empty-state early return above); the fixes query below genuinely
  // depends on runs, so it stays sequential.
  // limit 60 (was 30): sparklines need per-brand history, and 30 across many
  // brands starves the oldest ones.
  const [runsRes, profileRes] = await Promise.all([
    supabase
      .from("runs")
      .select(
        "id,brand_id,kind,status,stage,profile,created_at,finished_at,baseline_run_id,scores",
      )
      // migration 0038 soft-delete: exclude runs the owner hid (partial index backs this)
      .is("hidden_at", null)
      .order("created_at", { ascending: false })
      .limit(60),
    // maybeSingle: a missing profile row is legitimate (no crash) — .single() throws
    // on 0 rows and would mask a genuinely absent profile as a page error.
    supabase.from("profiles").select("plan,display_name").maybeSingle(),
  ]);
  const { data: runsData, error: runsError } = runsRes;
  // A DB error is NOT "no runs" — surface it to the error boundary.
  if (runsError) throw runsError;
  const runs = (runsData ?? []) as RunLite[];
  const { data: profile } = profileRes;
  const brandName = new Map(brands.map((b) => [b.id, b.name]));

  // PERF: bucket runs by brand ONCE. The card grid and the portfolio table both need
  // a per-brand slice; filtering `runs` per brand inside two separate maps was
  // O(brands × runs). runs is newest-first, so each bucket is newest-first too —
  // every `.find(latest…)` / `[0]` below keeps working unchanged.
  const runsByBrand = new Map<string, RunLite[]>();
  for (const r of runs) {
    const arr = runsByBrand.get(r.brand_id);
    if (arr) arr.push(r);
    else runsByBrand.set(r.brand_id, [r]);
  }

  // open-fix counts for each brand's latest done audit (portfolio column)
  const latestAuditIds = brands
    .map((b) =>
      (runsByBrand.get(b.id) ?? []).find((r) => r.kind === "audit" && r.status === "done"),
    )
    .filter(Boolean)
    .map((r) => r!.id);
  const { data: fixRows } = latestAuditIds.length
    ? await supabase
        .from("fixes")
        .select("run_id,published_at,artifact")
        .in("run_id", latestAuditIds)
    : { data: [] as { run_id: string; published_at: string | null; artifact: unknown }[] };
  const openFixes = new Map<string, number>();
  // draftedWaiting: open (unpublished) fixes that already have a drafted artifact
  // to ship — the "Your next move" nudge to /app/fixes.
  let draftedWaiting = 0;
  for (const f of fixRows ?? []) {
    if (!f.published_at) {
      openFixes.set(f.run_id, (openFixes.get(f.run_id) ?? 0) + 1);
      if (f.artifact !== null) draftedWaiting += 1;
    }
  }

  // Next weekly verify. Scheduling is an operator setting, not a plan: the
  // countdown shows only when FLAG_SCHEDULED_RUNS is on (src/inngest/schedule.ts).
  let countdown: string | null = null;
  if (flag("scheduledRuns")) {
    const now = new Date();
    const next = new Date(now);
    next.setUTCDate(now.getUTCDate() + ((8 - now.getUTCDay()) % 7 || 7));
    next.setUTCHours(9, 0, 0, 0);
    countdown = `Weekly verify: Monday (${Math.ceil((next.getTime() - now.getTime()) / 86400_000)}d)`;
  }

  // "Smart home" header data — the Right-now strip + ≤3 computed next moves.
  const activeRuns: ActiveRunLite[] = runs
    .filter((r) => r.status === "queued" || r.status === "running")
    .map((r) => ({
      id: r.id,
      brandName: brandName.get(r.brand_id) ?? "—",
      stage: r.stage,
    }));
  const nextMoves = computeNextMoves({
    now: new Date().getTime(),
    plan: profile?.plan ?? "audit",
    draftedFixes: draftedWaiting,
    brands: brands.map((b) => ({ id: b.id, name: b.name })),
    runs: runs.map((r) => ({
      id: r.id,
      brand_id: r.brand_id,
      kind: r.kind,
      status: r.status,
      created_at: r.created_at,
      finished_at: r.finished_at,
      baseline_run_id: r.baseline_run_id,
      scores: r.scores,
    })),
  });

  // PERF: cap the rich card grid. Each card renders a sparkline + delta badge + CTA;
  // uncapped, a large portfolio paid that render cost N times server-side. Show the 8
  // newest brands as cards; the FULL list is one compact row each in the portfolio
  // table below (the "view all" affordance links straight to it).
  const CARD_CAP = 8;
  const cardBrands = brands.slice(0, CARD_CAP);
  const hiddenBrandCount = brands.length - cardBrands.length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <HomeGreeting
        name={profile?.display_name ?? null}
        brandCount={brands.length}
        runningCount={activeRuns.length}
      />

      <NextMoves activeRuns={activeRuns} moves={nextMoves} />

      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl">Your brands</h2>
        {countdown && <span className="font-mono text-xs text-wire">{countdown}</span>}
      </div>

      {/* BRAND CARDS — capped at CARD_CAP; the rest live in the portfolio table below */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cardBrands.map((b) => {
          const bRuns = runsByBrand.get(b.id) ?? [];
          const active = bRuns.find((r) => r.status === "queued" || r.status === "running");
          const doneAudits = bRuns.filter((r) => r.kind === "audit" && r.status === "done");
          const latestDone = doneAudits[0];
          const score = latestDone ? scoredN(latestDone) : null;
          const series = trendSeries(bRuns);
          // A brand whose latest run failed (with nothing active) must not vanish into
          // "No completed audit yet" — surface it with a link to the failed run's page,
          // where the wired Retry lives. bRuns is ordered newest-first (runs query).
          const failedRun =
            !active && bRuns[0]?.status === "failed" ? bRuns[0] : null;
          const state = active ? "running" : latestDone ? "audit-done" : "none";
          return (
            <div key={b.id} className="flex flex-col gap-4 rounded-lg border border-line bg-card p-5">
              <div>
                <h2 className="font-display text-xl">{b.name}</h2>
                <p className="font-mono text-xs text-wire">{b.domain}</p>
              </div>

              {active ? (
                <Link
                  href={`/app/run/${active.id}`}
                  className="animate-pulse text-sm text-signal underline motion-reduce:animate-none"
                >
                  {active.stage || "running"}…
                </Link>
              ) : latestDone ? (
                <div className="flex flex-col gap-2">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-display text-3xl">{score ? `${score.pct}%` : "—"}</span>
                    <span className="text-xs uppercase tracking-wide text-wire">
                      recommended
                      <br />
                      latest audit
                    </span>
                    <Sparkline
                      values={series.map((p) => p.rec)}
                      label={`recommended answers across ${series.length} runs`}
                    />
                    <DeltaBadge series={series} />
                  </div>
                  {failedRun && failedRun.id !== latestDone.id && (
                    <Link
                      href={`/app/run/${failedRun.id}`}
                      className="text-xs text-pill-dismissed underline"
                    >
                      Your latest run hit a wall. You were not charged. See what happened →
                    </Link>
                  )}
                </div>
              ) : failedRun ? (
                <div className="flex flex-col gap-1">
                  <p className="text-sm text-wire">
                    Your last run hit a wall. You were not charged.
                  </p>
                  <Link
                    href={`/app/run/${failedRun.id}`}
                    className="text-sm text-signal underline"
                  >
                    See what happened &amp; retry →
                  </Link>
                </div>
              ) : (
                <p className="text-sm text-wire">No completed audit yet.</p>
              )}

              <div className="mt-auto flex flex-col gap-2">
                {latestDone && (
                  <Button asChild variant="outline" size="sm">
                    <PendingLink href={`/app/run/${latestDone.id}`}>Open latest report</PendingLink>
                  </Button>
                )}
                {series.length >= 2 ? (
                  <Button asChild variant="outline" size="sm">
                    <PendingLink href={`/app/brand/${b.id}`}>Movement</PendingLink>
                  </Button>
                ) : (
                  // Locked teaser — same size slot as the real button so the card
                  // layout never jumps, but muted + non-interactive. Surfaces the
                  // Movement page during the exact window a user should want it.
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-disabled="true"
                    tabIndex={-1}
                    title="Movement charts how your recommendation rate changes across runs. It needs a second data point, so it unlocks after your first verify."
                    className="cursor-not-allowed text-wire opacity-60 hover:bg-background hover:text-wire"
                  >
                    Movement (unlocks after your first verify)
                  </Button>
                )}
                <RunCta brandId={b.id} state={state} activeRunId={active?.id} />
              </div>
            </div>
          );
        })}

        {/* view-all affordance — only when the grid is capped; jumps to the full table */}
        {hiddenBrandCount > 0 && (
          <a
            href="#all-brands"
            className="flex min-h-40 flex-col items-center justify-center gap-1 rounded-lg border border-line bg-card text-wire transition-colors hover:border-ink hover:text-ink"
          >
            <span className="font-display text-3xl">+{hiddenBrandCount}</span>
            <span className="text-sm">View all {brands.length} brands ↓</span>
          </a>
        )}

        {/* add-brand card */}
        <Link
          href="/app/onboarding"
          className="flex min-h-40 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-line text-wire transition-colors hover:border-ink hover:text-ink"
        >
          <span className="font-display text-3xl">+</span>
          <span className="text-sm">Audit another brand</span>
        </Link>
      </div>

      {/* PORTFOLIO — one scannable row per brand (≥2 brands) */}
      {brands.length >= 2 && (
        <div id="all-brands" className="scroll-mt-6 rounded-lg border border-line bg-card">
          <div className="border-b border-line px-6 py-3 font-mono text-xs uppercase tracking-wider text-wire">
            All brands
          </div>
          <ScrollX hint="Scroll sideways for trend, rival and fixes">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-wire">
                  <th className="px-6 py-2 font-normal">Brand</th>
                  <th className="py-2 text-right font-normal">Recommended</th>
                  <th className="py-2 pl-4 font-normal">Trend</th>
                  <th className="py-2 font-normal">Change</th>
                  <th className="py-2 font-normal">Top rival</th>
                  <th className="py-2 text-right font-normal">Open fixes</th>
                  <th className="py-2 pl-4 pr-6 font-normal">Last run</th>
                </tr>
              </thead>
              <tbody>
                {brands.map((b) => {
                  const bRuns = runsByBrand.get(b.id) ?? [];
                  const latestDone = bRuns.find(
                    (r) => r.kind === "audit" && r.status === "done",
                  );
                  const score = latestDone ? scoredN(latestDone) : null;
                  const series = trendSeries(bRuns);
                  const rival = latestDone
                    ? topRival(sovEntries(latestDone.scores?.share_of_voice), b.name)
                    : undefined;
                  return (
                    <tr key={b.id} className="border-b border-line last:border-0 hover:bg-paper">
                      <td className="px-6 py-3">
                        <PendingLink
                          href={latestDone ? `/app/run/${latestDone.id}` : "/app/onboarding"}
                          className="block font-medium"
                        >
                          {b.name}
                        </PendingLink>
                      </td>
                      <td className="py-3 text-right font-mono tabular-nums">
                        {score ? `${score.rec} of ${score.answered}` : "—"}
                      </td>
                      <td className="py-3 pl-4 align-middle">
                        {series.length >= 3 ? (
                          <PendingLink
                            href={`/app/brand/${b.id}`}
                            aria-label={`${b.name} movement`}
                          >
                            <Sparkline
                              values={series.map((p) => p.rec)}
                              label={`recommended answers across ${series.length} runs`}
                            />
                          </PendingLink>
                        ) : (
                          // Sparkline suppresses under 3 points — say so honestly
                          // instead of leaving an empty clickable cell.
                          <span className="font-mono text-[10px] text-wire">needs 3 runs</span>
                        )}
                      </td>
                      <td className="py-3">
                        {series.length >= 2 ? (
                          <DeltaBadge series={series} />
                        ) : (
                          <span className="text-wire">—</span>
                        )}
                      </td>
                      <td className="py-3 text-wire">{rival ? rival[0] : "—"}</td>
                      <td className="py-3 text-right font-mono tabular-nums">
                        {latestDone ? (openFixes.get(latestDone.id) ?? 0) : "—"}
                      </td>
                      <td className="py-3 pl-4 pr-6 text-wire" suppressHydrationWarning>
                        {latestDone
                          ? new Date(latestDone.created_at).toLocaleDateString("en-GB", {
                              day: "2-digit",
                              month: "short",
                            })
                          : "no audit yet"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollX>
        </div>
      )}

      {/* RECENT RUNS — across all brands, client-filtered (brand · kind · status).
          Score is precomputed here so the client island stays presentational. */}
      <RecentRuns
        runs={runs.map(
          (run): RecentRun => ({
            id: run.id,
            brand_id: run.brand_id,
            brandName: brandName.get(run.brand_id) ?? "—",
            kind: run.kind,
            status: run.status,
            stage: run.stage,
            profile: run.profile,
            created_at: run.created_at,
            score: scoredN(run),
          }),
        )}
        brands={brands.map((b) => ({ id: b.id, name: b.name }))}
      />
    </div>
  );
}
