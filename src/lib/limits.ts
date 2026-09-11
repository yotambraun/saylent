// Cost-control config + pure helpers. No Supabase / Next imports so createRun /
// createBrand can enforce them and vitest can pin the math.
//
// These three limits ARE the whole quota system: a deployment-wide daily spend
// ceiling, a per-brand rolling-window throttle, and a per-user brand cap. There
// are no plans and no credits — the operator's env is the only thing that says
// how much a deployment may spend. Every limit has a sane default and an env
// override, so a cap can change without a code edit.

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Max brands one user may own. Default 5 — self-host friendly; an operator who
 *  wants more (or fewer) sets BRAND_LIMIT. `BRAND_LIMIT_DEFAULT` is still read as
 *  the older name for the same knob so an existing .env keeps working. */
export function brandLimit(): number {
  return num(process.env.BRAND_LIMIT ?? process.env.BRAND_LIMIT_DEFAULT, 5);
}

/** Rolling-window throttle on MANUAL runs per brand — complements (does not
 *  replace) the one-active-run-per-brand concurrency guard. */
export const THROTTLE_WINDOW_HOURS = num(process.env.RUN_THROTTLE_WINDOW_HOURS, 24);
export const MAX_AUDITS_PER_WINDOW = num(process.env.RUN_THROTTLE_AUDITS, 3);
export const MAX_VERIFIES_PER_WINDOW = num(process.env.RUN_THROTTLE_VERIFIES, 3);

/** ISO timestamp for the start of the rolling window ending at `now`. */
export function throttleWindowStart(now: number = Date.now()): string {
  return new Date(now - THROTTLE_WINDOW_HOURS * 3600_000).toISOString();
}

/** Per-kind cap for the rolling window. */
export function throttleCap(kind: "audit" | "verify"): number {
  return kind === "audit" ? MAX_AUDITS_PER_WINDOW : MAX_VERIFIES_PER_WINDOW;
}

/** True if a new run of `kind` would exceed the window cap, given how many runs
 *  of that kind the brand already started inside the window. Pure — the DB does
 *  the count; this only compares. */
export function throttleExceeded(kind: "audit" | "verify", countInWindow: number): boolean {
  return countInWindow >= throttleCap(kind);
}

/** Global daily provider-spend ceiling in USD. Crossing it trips the kill
 *  switch (runs_paused). Env override is the fallback when app_settings has no
 *  per-instance cap set. */
export const DAILY_SPEND_CAP_USD = num(process.env.DAILY_SPEND_CAP_USD, 20);

/** True when realized spend today (sum of runs.est_cost_usd) is at/over the
 *  cap. Pure — the DB sums; this only compares. */
export function spendCeilingExceeded(
  todaySpendUsd: number,
  cap: number = DAILY_SPEND_CAP_USD,
): boolean {
  return cap > 0 && todaySpendUsd >= cap;
}
