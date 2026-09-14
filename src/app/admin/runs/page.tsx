// Operator QC console — /admin/runs, the exceptions-first run feed ("never be
// blind to what customers got"). Every run, newest first (cap 100), each with an
// honest HEALTH BADGE read from runs.health (contract in run-health.ts). requireAdmin() gates it (layout + here); all reads go through
// the service role (createAdminClient) — cross-user, RLS-bypassing, read-only.
// NO write surface, NO run-creation, NO audit_log entry (viewing is read-only,
// consistent with view-as).
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import type { RunHealth } from "@saylent/report/run-health";
import { createAdminClient } from "@/lib/supabase/admin";
import { LoadError } from "../load-error";
import { artifactsLabel, passesRunFilter, runHealthBadge } from "./health-badge";

export const metadata = { title: "Runs · Operator console · Saylent" };

const CAP = 100;

// timezone-stable, hydration-safe timestamp (UTC — matches the app's dossier convention)
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmt(ts: string): string {
  const d = new Date(ts);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)} · ${hh}:${mm}`;
}
function duration(created: string, finished: string | null): string {
  if (!finished) return "—";
  const s = Math.round((new Date(finished).getTime() - new Date(created).getTime()) / 1000);
  if (s < 0) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

type RunFeedRow = {
  id: string;
  brand_id: string | null;
  user_id: string | null;
  kind: string;
  status: string;
  profile: string;
  est_cost_usd: number | null;
  created_at: string;
  finished_at: string | null;
};

export default async function AdminRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ problems?: string; weak?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const problemsOnly = sp.problems === "1";
  const includeWeak = sp.weak === "1";
  const admin = createAdminClient();

  // Main feed — newest first, capped. Never selects `health` here so a deployment
  // that has not applied that migration yet can NEVER break the feed.
  const { data: runsData, error: runsError } = await admin
    .from("runs")
    .select("id,brand_id,user_id,kind,status,profile,est_cost_usd,created_at,finished_at")
    .order("created_at", { ascending: false })
    .limit(CAP);
  // A failed feed query renders as an empty feed otherwise — which on THIS page
  // reads as "no problem runs", the exact opposite of the truth.
  if (runsError) return <LoadError what="the run feed" message={runsError.message} />;
  const runs = (runsData ?? []) as RunFeedRow[];

  // DEFENSIVE health read — separate query so a missing column degrades gracefully
  // to "pre-health" for every row rather than erroring the page.
  const healthById = new Map<string, RunHealth>();
  if (runs.length) {
    const { data: healthData, error: healthErr } = await admin
      .from("runs")
      .select("id,health")
      .in("id", runs.map((r) => r.id));
    if (!healthErr && healthData) {
      for (const row of healthData as { id: string; health: RunHealth | null }[]) {
        if (row.health) healthById.set(row.id, row.health);
      }
    }
    // healthErr (the column is not migrated yet) → leave the map empty → all rows
    // render an honest "pre-health" badge.
  }

  // Resolve brand + user labels in ONE batch each (no N+1).
  const brandIds = [...new Set(runs.map((r) => r.brand_id).filter(Boolean) as string[])];
  const userIds = [...new Set(runs.map((r) => r.user_id).filter(Boolean) as string[])];
  const [{ data: brandRows }, { data: userRows }] = await Promise.all([
    brandIds.length
      ? admin.from("brands").select("id,name,domain").in("id", brandIds)
      : Promise.resolve({ data: [] as { id: string; name: string; domain: string }[] }),
    userIds.length
      ? admin.from("profiles").select("id,email").in("id", userIds)
      : Promise.resolve({ data: [] as { id: string; email: string }[] }),
  ]);
  const brandById = new Map((brandRows ?? []).map((b) => [b.id, b]));
  const emailById = new Map((userRows ?? []).map((u) => [u.id, u.email]));

  // Badge each row, then apply the toggles.
  const rows = runs
    .map((r) => {
      const health = healthById.get(r.id) ?? null;
      return { r, health, badge: runHealthBadge(r.status, health) };
    })
    .filter(({ badge }) => passesRunFilter(badge, { problemsOnly, includeWeak }));

  const problemCount = runs.filter(
    (r) => runHealthBadge(r.status, healthById.get(r.id) ?? null).problem,
  ).length;

  // Toggle links (server-rendered — no client JS needed).
  const problemsHref = problemsOnly
    ? "/admin/runs"
    : `/admin/runs?problems=1${includeWeak ? "&weak=1" : ""}`;
  const weakHref = includeWeak
    ? `/admin/runs${problemsOnly ? "?problems=1" : ""}`
    : `/admin/runs?problems=1&weak=1`;

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Runs</h1>
          <p className="text-sm text-wire">
            Every run, newest first: the quality feed. Never be blind to what customers got.
          </p>
        </div>
        <span className="font-mono text-xs text-wire tabular-nums">
          {rows.length} shown · {problemCount} problem{problemCount === 1 ? "" : "s"} in last {runs.length}
        </span>
      </div>

      {/* FILTER TOGGLES — separate, honestly labeled. "Problems" = degraded/failed;
          "weak" is a product outcome kept distinct. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Link
          href={problemsHref}
          className={`rounded-full px-3 py-1 font-mono ring-1 transition-colors ${
            problemsOnly
              ? "bg-pill-dismissed/15 text-pill-dismissed ring-pill-dismissed/40"
              : "text-wire ring-line hover:text-ink"
          }`}
        >
          {problemsOnly ? "✓ problems only" : "problems only"}
        </Link>
        <Link
          href={weakHref}
          className={`rounded-full px-3 py-1 font-mono ring-1 transition-colors ${
            includeWeak ? "bg-muted text-ink ring-line" : "text-wire ring-line hover:text-ink"
          }`}
          title="Weak is a product outcome (recommended <10% of scored), not a pipeline bug: kept separate."
        >
          {includeWeak ? "✓ include weak" : "+ include weak"}
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-wire">
              <th className="px-4 py-2 font-normal">Created (UTC)</th>
              <th className="py-2 font-normal">Brand</th>
              <th className="py-2 font-normal">User</th>
              <th className="py-2 font-normal">Kind</th>
              <th className="py-2 font-normal">Health</th>
              <th className="py-2 text-right font-normal">Est. cost</th>
              <th className="py-2 text-right font-normal">Duration</th>
              <th className="py-2 text-right font-normal">Artifacts</th>
              <th className="py-2 pl-6 pr-4 font-normal">Open</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-10 text-center text-wire">
                  {problemsOnly ? "No problem runs in the last 100. Clean feed." : "No runs yet."}
                </td>
              </tr>
            ) : (
              rows.map(({ r, health, badge }) => {
                const brand = r.brand_id ? brandById.get(r.brand_id) : null;
                const email = r.user_id ? emailById.get(r.user_id) : null;
                const arts = artifactsLabel(health);
                return (
                  <tr key={r.id} className="border-b border-line last:border-0 hover:bg-paper">
                    <td className="px-4 py-3 font-mono text-xs text-wire" suppressHydrationWarning>
                      {fmt(r.created_at)}
                      {r.profile === "smoke" && <span className="ml-1 text-pill-absent">· smoke</span>}
                    </td>
                    <td className="py-3">
                      {brand ? (
                        <Link
                          href={`/admin/view-as/brand/${brand.id}`}
                          className="text-signal hover:underline"
                        >
                          {brand.name}
                        </Link>
                      ) : (
                        <span className="text-wire">—</span>
                      )}
                    </td>
                    <td className="py-3">
                      {r.user_id ? (
                        <Link
                          href={`/admin/users/${r.user_id}`}
                          className="text-ink hover:underline"
                          title={email ?? undefined}
                        >
                          {email ?? `${r.user_id.slice(0, 8)}…`}
                        </Link>
                      ) : (
                        <span className="text-wire">—</span>
                      )}
                    </td>
                    <td className="py-3 font-mono text-xs text-wire">{r.kind}</td>
                    <td className="py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls} ${
                          badge.loud ? "font-semibold" : ""
                        }`}
                        title={badge.notes.length ? badge.notes.join("\n") : undefined}
                      >
                        {badge.label}
                        {badge.notes.length > 0 && <span className="ml-1 opacity-70">·{badge.notes.length}</span>}
                      </span>
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums text-wire">
                      {r.est_cost_usd != null ? `$${Number(r.est_cost_usd).toFixed(2)}` : "—"}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums text-wire">
                      {duration(r.created_at, r.finished_at)}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums text-wire">{arts ?? "—"}</td>
                    <td className="py-3 pr-4">
                      {r.status === "done" && r.kind === "audit" ? (
                        <Link href={`/admin/view-as/${r.id}`} className="text-signal hover:underline">
                          view-as ↗
                        </Link>
                      ) : (
                        <span className="text-xs text-wire">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="font-mono text-xs text-wire">
        Health is written once by the pipeline&apos;s final step and read here. Never re-derived.
        Older runs (before the health birth-certificate) show an honest &ldquo;pre-health&rdquo; badge.
      </p>
    </div>
  );
}
