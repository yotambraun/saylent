// Pure spend-aggregation for the operator console's
// global spend dashboard. No Supabase/Next imports so the admin home can feed it
// raw runs rows and vitest can pin the math. The DB does the read; this only
// buckets and sums (mirrors the createRun spend-ceiling helper's split).

export type SpendRun = { created_at: string; est_cost_usd: number | string | null };
export type DayBucket = { date: string; totalUsd: number; count: number };

/** UTC calendar-day key (YYYY-MM-DD) for an ISO timestamp. */
function utcDayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Sum est_cost_usd across runs (nulls count as 0). */
export function sumSpend(runs: SpendRun[]): number {
  return runs.reduce((s, r) => s + Number(r.est_cost_usd ?? 0), 0);
}

/** Total spend for the UTC day containing `now`. */
export function todaySpend(runs: SpendRun[], now: Date = new Date()): number {
  const key = now.toISOString().slice(0, 10);
  return sumSpend(runs.filter((r) => utcDayKey(r.created_at) === key));
}

/** Per-UTC-day spend + run count for the last `days` days ending on the day of
 *  `now`, newest first. Every day in the window is present (zero-filled), so the
 *  dashboard renders a stable N-row strip regardless of gaps. */
export function dailySpendBuckets(
  runs: SpendRun[],
  days: number,
  now: Date = new Date(),
): DayBucket[] {
  const byDay = new Map<string, { totalUsd: number; count: number }>();
  for (const r of runs) {
    const key = utcDayKey(r.created_at);
    const cur = byDay.get(key) ?? { totalUsd: 0, count: 0 };
    cur.totalUsd += Number(r.est_cost_usd ?? 0);
    cur.count += 1;
    byDay.set(key, cur);
  }
  const out: DayBucket[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const hit = byDay.get(key) ?? { totalUsd: 0, count: 0 };
    out.push({ date: key, totalUsd: hit.totalUsd, count: hit.count });
  }
  return out;
}
