// The admin funnel view. Counts, not charts: the
// activation funnel (signup → onboarding_started → first_audit_started →
// receipt_opened → verify_run) and events-per-day over the last 14 days. Service-role
// reads (analytics_events has no admin SELECT policy — the service client bypasses
// RLS); requireAdmin() gates it (layout + here). All aggregation is the pure math
// in analytics-funnel.ts (unit-tested).
import { Card, CardContent, CardHeader, CardTitle } from "@saylent/report/ui/card";
import {
  activationFunnel,
  eventCounts,
  eventsPerDay,
  type AnalyticsRow,
} from "@/lib/analytics-funnel";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { LoadError } from "../load-error";

export const metadata = { title: "Analytics · Operator console · Saylent" };

const WINDOW_DAYS = 14;

export default async function AdminAnalyticsPage() {
  await requireAdmin();
  const admin = createAdminClient();

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - WINDOW_DAYS);

  // Funnel is computed over ALL history (an activation funnel is cumulative);
  // the per-day strip is the recent window. Both are cheap at launch scale.
  const [{ data: funnelRows, error: funnelError }, { data: recentRows, error: recentError }] =
    await Promise.all([
    admin.from("analytics_events").select("event,at,user_id,anon_id"),
    admin.from("analytics_events").select("event,at,user_id,anon_id").gte("at", since.toISOString()),
  ]);

  // Without this branch a failed read renders as "No events recorded yet" — an
  // operator would read a broken query as a dead funnel.
  const error = funnelError ?? recentError;
  if (error) return <LoadError what="the analytics events" message={error.message} />;

  const all = (funnelRows ?? []) as AnalyticsRow[];
  const recent = (recentRows ?? []) as AnalyticsRow[];

  const funnel = activationFunnel(all);
  const perDay = eventsPerDay(recent, WINDOW_DAYS);
  const counts = eventCounts(all);
  const eventNames = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl">Analytics</h1>
        <span className="font-mono text-xs text-wire tabular-nums">{all.length} events total</span>
      </div>

      {/* ACTIVATION FUNNEL */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Activation funnel</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {all.length === 0 ? (
            <p className="py-4 text-center text-wire">No events recorded yet.</p>
          ) : (
            funnel.map((f) => (
              <div key={f.step} className="flex items-center gap-3">
                <span className="w-44 shrink-0 font-mono text-xs text-wire">{f.step}</span>
                <div className="h-5 flex-1 overflow-hidden rounded bg-paper ring-1 ring-line">
                  <div
                    className="h-full bg-signal/30"
                    style={{ width: `${Math.max(f.pct ?? 0, f.users > 0 ? 2 : 0)}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-ink">
                  {f.users} · {f.pct === null ? "—" : `${f.pct}%`}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* EVENTS PER DAY */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Events per day (last {WINDOW_DAYS})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 font-mono text-xs">
          {perDay.map((d) => (
            <div key={d.date} className="flex items-baseline justify-between border-b border-line pb-1 last:border-0">
              <span className="text-wire tabular-nums">{d.date}</span>
              <span className="tabular-nums text-ink">{d.total}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* EVENT TOTALS */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Event totals (all time)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          {eventNames.length === 0 ? (
            <p className="py-4 text-center text-wire">No events recorded yet.</p>
          ) : (
            eventNames.map((name) => (
              <div key={name} className="flex items-baseline justify-between border-b border-line pb-1 font-mono text-xs last:border-0">
                <span className="text-wire">{name}</span>
                <span className="tabular-nums text-ink">{counts[name]}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
