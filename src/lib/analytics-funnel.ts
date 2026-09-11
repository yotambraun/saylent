// Pure aggregation for the admin funnel view. No
// Supabase/Next imports so the admin page can feed it raw analytics_events rows
// and vitest can pin the math (mirrors admin-metrics.ts's split: the DB does the
// read, this only counts and buckets).

export type AnalyticsRow = {
  event: string;
  at: string;
  user_id?: string | null;
  anon_id?: string | null;
};

// The activation funnel, in order. A user counts toward a step if they fired that
// event at least once. Steps are cumulative in intent but counted independently
// (we do NOT require the previous step — an event may land out of order), so the
// view reads honestly even when instrumentation is partial.
//
// The last step used to be `purchase`, permanently at "0 · 0%" on a product that
// removed billing. The real end of activation here is a VERIFY:
// the user shipped a fix and came back to measure whether it moved. That is what
// `verify_run` records, and it is the step that says the loop closed.
export const FUNNEL_STEPS = [
  "signup",
  "onboarding_started",
  "first_audit_started",
  "receipt_opened",
  "verify_run",
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

/** `pct` is null when there is no base to divide by — with zero signups
 *  recorded, a step with 1 user is not "0%", it has no percentage at all. The
 *  view printed "1 · 0%" for exactly that case. */
export type FunnelRow = { step: FunnelStep; users: number; pct: number | null };
export type DayEventBucket = { date: string; total: number; byEvent: Record<string, number> };

function utcDayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Total occurrences per event name across all rows. */
export function eventCounts(rows: AnalyticsRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.event] = (out[r.event] ?? 0) + 1;
  return out;
}

/** Distinct identities (user_id, else anon_id) that fired each funnel step, with a
 *  percentage relative to the FIRST step (signup). The classic activation funnel:
 *  signup → onboarding_started → first_audit_started → receipt_opened → verify_run. */
export function activationFunnel(rows: AnalyticsRow[]): FunnelRow[] {
  const idsByStep = new Map<string, Set<string>>();
  for (const step of FUNNEL_STEPS) idsByStep.set(step, new Set());
  for (const r of rows) {
    const set = idsByStep.get(r.event);
    if (!set) continue;
    const id = r.user_id ?? r.anon_id;
    if (id) set.add(id);
  }
  const base = idsByStep.get(FUNNEL_STEPS[0])!.size;
  return FUNNEL_STEPS.map((step) => {
    const users = idsByStep.get(step)!.size;
    return { step, users, pct: base > 0 ? Math.round((users / base) * 100) : null };
  });
}

/** Per-UTC-day event counts for the last `days` days ending on the day of `now`,
 *  newest first. Every day in the window is present (zero-filled) so the view
 *  renders a stable strip regardless of gaps. */
export function eventsPerDay(
  rows: AnalyticsRow[],
  days: number,
  now: Date = new Date(),
): DayEventBucket[] {
  const byDay = new Map<string, { total: number; byEvent: Record<string, number> }>();
  for (const r of rows) {
    const key = utcDayKey(r.at);
    const cur = byDay.get(key) ?? { total: 0, byEvent: {} };
    cur.total += 1;
    cur.byEvent[r.event] = (cur.byEvent[r.event] ?? 0) + 1;
    byDay.set(key, cur);
  }
  const out: DayEventBucket[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const hit = byDay.get(key) ?? { total: 0, byEvent: {} };
    out.push({ date: key, total: hit.total, byEvent: hit.byEvent });
  }
  return out;
}
