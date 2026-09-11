// The operator home, framed as "Budget & limits":
// the global spend dashboard + kill switch +
// which provider keys are configured, then the searchable user list (email ·
// spend · created). No plans/credits: this self-host app has neither, so the
// per-user levers (brand count vs BRAND_LIMIT, the deployment-wide throttle)
// are shown read-only on /admin/users/[id].
// Service-role reads across ALL users (createAdminClient bypasses RLS);
// requireAdmin() in the layout AND here gates access.
import { Card, CardContent, CardHeader, CardTitle } from "@saylent/report/ui/card";
import { dailySpendBuckets, sumSpend, todaySpend } from "@/lib/admin-metrics";
import { requireAdmin } from "@/lib/admin-auth";
import { getAppSettings } from "@/lib/app-settings";
import { listProviderStatus } from "@/lib/provider-check";
import { createAdminClient } from "@/lib/supabase/admin";
import { KillSwitchPanel, ProvidersCard, SearchableUsers, type UserRow } from "./home-client";
import { LoadError } from "./load-error";

export const metadata = { title: "Operator · Admin · Saylent" };

export default async function AdminHomePage() {
  await requireAdmin();
  const admin = createAdminClient();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

  const [
    { data: profiles, error: profilesError },
    { data: allRuns, error: allRunsError },
    { data: recentRuns, error: recentRunsError },
    settings,
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id,email,display_name,role,created_at")
      .order("created_at", { ascending: false }),
    // full spend-per-user needs every run's cost; cheap at this scale.
    admin.from("runs").select("user_id,est_cost_usd,created_at"),
    // last-7d window for the daily spend strip.
    admin
      .from("runs")
      .select("created_at,est_cost_usd")
      .gte("created_at", sevenDaysAgo.toISOString()),
    getAppSettings(),
  ]);

  const spendByUser = new Map<string, number>();
  const lastActivity = new Map<string, string>();
  for (const r of allRuns ?? []) {
    spendByUser.set(r.user_id, (spendByUser.get(r.user_id) ?? 0) + Number(r.est_cost_usd ?? 0));
    const prev = lastActivity.get(r.user_id);
    if (!prev || r.created_at > prev) lastActivity.set(r.user_id, r.created_at);
  }

  const rows: UserRow[] = (profiles ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    displayName: p.display_name,
    role: p.role,
    spendUsd: spendByUser.get(p.id) ?? 0,
    createdAt: p.created_at,
    lastActivity: lastActivity.get(p.id) ?? null,
  }));

  // presence + provenance (env or the encrypted console store) — one RPC, no
  // key material and no decryption.
  const providers = await listProviderStatus();

  // A failed spend query must never render as $0.00 — an operator would read that
  // as "nothing spent today" and lift a cap that is still holding.
  const spendError = allRunsError ?? recentRunsError;

  const buckets = dailySpendBuckets(recentRuns ?? [], 7);
  const today = todaySpend(recentRuns ?? []);
  const weekTotal = sumSpend(recentRuns ?? []);
  const cap = settings.dailySpendCapUsd;
  const capPct = cap > 0 ? Math.min(100, Math.round((today / cap) * 100)) : 0;

  return (
    <div className="flex w-full flex-col gap-8">
      {/* BUDGET & LIMITS — spend, kill switch, providers. Per-user brand count +
          the deployment-wide throttle (read-only) are shown on
          /admin/users/[id]. */}
      <section id="budget-limits" className="flex flex-col gap-4">
        <h2 className="font-display text-xl">Budget &amp; limits</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {spendError ? (
            <LoadError what="the spend figures" message={spendError.message} />
          ) : (
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Spend (last 7 days)</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex items-baseline justify-between border-b border-line pb-3">
                <span className="text-wire">Today</span>
                <span className="font-mono text-2xl tabular-nums text-ink">
                  ${today.toFixed(2)}
                  {cap > 0 && (
                    <span className="ml-2 text-sm text-wire">
                      / ${cap.toFixed(0)} cap ({capPct}%)
                    </span>
                  )}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {buckets.map((b) => (
                  <div key={b.date} className="flex items-baseline justify-between font-mono text-xs">
                    <span className="text-wire tabular-nums">{b.date}</span>
                    <span className="text-wire tabular-nums">{b.count} runs</span>
                    <span className="tabular-nums text-ink">${b.totalUsd.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-baseline justify-between border-t border-line pt-2 font-mono text-xs">
                <span className="text-wire">7-day total</span>
                <span className="tabular-nums text-ink">${weekTotal.toFixed(2)}</span>
              </div>
            </CardContent>
          </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="font-display">Cost control</CardTitle>
            </CardHeader>
            <CardContent>
              <KillSwitchPanel initialPaused={settings.runsPaused} initialCap={cap} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-display">Providers</CardTitle>
            </CardHeader>
            <CardContent>
              <ProvidersCard initial={providers} />
            </CardContent>
          </Card>
        </div>
      </section>

      {/* USERS */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h1 className="font-display text-2xl">Users</h1>
          {!profilesError && (
            <span className="font-mono text-xs text-wire tabular-nums">{rows.length} total</span>
          )}
        </div>
        {profilesError ? (
          <LoadError what="the user list" message={profilesError.message} />
        ) : (
          <SearchableUsers rows={rows} />
        )}
      </section>
    </div>
  );
}
