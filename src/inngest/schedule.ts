// PURE scheduling math for the
// scheduled runs (weekly verify + monthly audit). No Supabase / Inngest imports
// so vitest can pin every rule and the DB layer (functions.ts) just supplies
// facts. Two concerns live here:
//
//   1. ELIGIBILITY — which brands a cron should dispatch, and the 24h skip. There
//      are no plans: the operator turns scheduling on with FLAG_SCHEDULED_RUNS
//      (checked in functions.ts) and a brand qualifies once it has a completed
//      audit. createRun remains the authority (it re-checks concurrency, throttle,
//      spend ceiling, kill switch); this only avoids obviously-wasted dispatches.
//   2. TZ-AWARE JITTER — a single weekly cron at 09:00 UTC would fire every
//      verify at the same instant (the thundering herd). We offset each brand's
//      dispatch to the customer's LOCAL 09:00, which also spreads load across the
//      globe, plus a small deterministic per-brand jitter so brands in the same
//      timezone don't all fire on the same second either.

export type CronKind = "verify" | "audit";

/** The facts a cron needs to decide on ONE brand. Supplied by the DB layer. */
export interface BrandSchedule {
  brandId: string;
  userId: string;
  /** owner's IANA timezone (profiles.timezone); null/invalid → UTC fallback */
  timezone: string | null;
  /** does the brand have at least one status='done' AUDIT run (verify baseline)? */
  hasDoneAudit: boolean;
  /** ISO timestamp of the brand's most recent run (ANY kind/status), or null */
  lastRunAt: string | null;
}

const DAY_MS = 86_400_000;

/** True if the brand had a run inside the trailing 24h of `now` (the docs' skip
 *  rule). null lastRunAt → never ran → not within. */
export function ranWithinLast24h(lastRunAt: string | null, now: number = Date.now()): boolean {
  if (!lastRunAt) return false;
  const t = new Date(lastRunAt).getTime();
  if (!Number.isFinite(t)) return false;
  return now - t < DAY_MS;
}

/** Weekly verify eligibility: a completed audit to baseline against, and no run
 *  in the last 24h (an overlapping manual/monthly run wins). The operator switch
 *  (FLAG_SCHEDULED_RUNS) gates the whole cron one level up. */
export function eligibleForWeeklyVerify(b: BrandSchedule, now: number = Date.now()): boolean {
  return b.hasDoneAudit && !ranWithinLast24h(b.lastRunAt, now);
}

/** Monthly audit eligibility: the same rule — a brand the operator has actually
 *  audited once, and no run in the last 24h (which auto-skips a brand that just
 *  had a weekly verify). A never-audited brand is never re-audited by a cron. */
export function eligibleForMonthlyAudit(b: BrandSchedule, now: number = Date.now()): boolean {
  return b.hasDoneAudit && !ranWithinLast24h(b.lastRunAt, now);
}

/** Kind-dispatch: the right predicate for a cron kind. */
export function isEligible(b: BrandSchedule, kind: CronKind, now: number = Date.now()): boolean {
  return kind === "verify" ? eligibleForWeeklyVerify(b, now) : eligibleForMonthlyAudit(b, now);
}

// ---- timezone-aware jitter --------------------------------------------------

/** Minutes-past-local-midnight for `instant` in IANA `timezone`. DST-correct
 *  (uses the wall clock the platform reports). Throws on an invalid zone —
 *  callers use `safeLocalMinutesOfDay` which falls back to UTC. */
function localMinutesOfDay(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

function safeLocalMinutesOfDay(instant: Date, timezone: string | null): number {
  if (!timezone) return localMinutesOfDay(instant, "UTC");
  try {
    return localMinutesOfDay(instant, timezone);
  } catch {
    return localMinutesOfDay(instant, "UTC");
  }
}

/** Deterministic per-brand jitter in [0, windowMs). Hash of brandId so the value
 *  is STABLE across Inngest step replays (a non-deterministic sleep would break
 *  durable execution) yet differs brand-to-brand within one timezone. */
export function jitterForBrand(brandId: string, windowMs: number): number {
  if (windowMs <= 0) return 0;
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < brandId.length; i++) {
    h ^= brandId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % windowMs;
}

/** Default targets: dispatch at the customer's local 09:00 (matches the 0 9 cron
 *  in the customer's zone) and jitter within a 30-minute window. */
export const LOCAL_TARGET_MINUTE = 9 * 60;
export const JITTER_WINDOW_MS = 30 * 60_000;

/**
 * Delay (ms) from the cron fire-instant until this brand should be dispatched, so
 * dispatch lands at ~09:00 in the owner's timezone plus a per-brand jitter. The
 * result is always in [0, 24h + jitterWindow): if local 09:00 already passed
 * today it wraps to the next local 09:00, which is exactly the global load spread
 * the docs want (a weekly job landing a few hours later is immaterial, and the
 * 24h-skip in createRun prevents any double with a manual run in between).
 */
export function dispatchDelayMs(
  b: Pick<BrandSchedule, "brandId" | "timezone">,
  fireInstant: Date = new Date(),
  opts: { targetMinute?: number; jitterWindowMs?: number } = {},
): number {
  const targetMinute = opts.targetMinute ?? LOCAL_TARGET_MINUTE;
  const jitterWindowMs = opts.jitterWindowMs ?? JITTER_WINDOW_MS;
  const nowLocal = safeLocalMinutesOfDay(fireInstant, b.timezone);
  const minutesUntilTarget = ((targetMinute - nowLocal) % 1440 + 1440) % 1440;
  return minutesUntilTarget * 60_000 + jitterForBrand(b.brandId, jitterWindowMs);
}
