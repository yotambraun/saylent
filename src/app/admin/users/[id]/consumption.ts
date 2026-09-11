// /admin/users/[id] consumption strip — pure aggregation over analytics_events
// for ONE user. The operator's "did they actually USE what we delivered?" signal,
// and the churn-risk flag: a DONE audit with ZERO receipt_opened events in the
// 7 days after completion = "delivered, never opened". Kept pure (no DB / React)
// so the counting rules are unit-tested; the page does one batched read and
// hands the rows in.
import type { AnalyticsEvent } from "@/lib/analytics";

const WINDOW_DAYS = 7;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

export interface EventRow {
  event: string;
  at: string;
  props: Record<string, unknown> | null;
}

export interface DoneAudit {
  id: string;
  finished_at: string | null;
}

export interface NeverOpened {
  runId: string;
  finishedAt: string;
  /** true once the 7-day window has fully elapsed (a settled churn signal);
   *  false = still inside the window (they may yet open it). */
  windowClosed: boolean;
}

export interface Consumption {
  receiptsOpened: { count: number; lastAt: string | null };
  artifactsCopied: number;
  fixesShipped: number;
  verifyRuns: number;
  lastActivity: string | null;
  neverOpened: NeverOpened[];
}

function countAndLast(rows: EventRow[], event: AnalyticsEvent): { count: number; lastAt: string | null } {
  let count = 0;
  let lastAt: string | null = null;
  for (const r of rows) {
    if (r.event !== event) continue;
    count++;
    if (!lastAt || r.at > lastAt) lastAt = r.at;
  }
  return { count, lastAt };
}

/** Aggregate one user's consumption. `now` is injectable for deterministic tests. */
export function computeConsumption(
  events: EventRow[],
  doneAudits: DoneAudit[],
  now: Date = new Date(),
): Consumption {
  const receiptsOpened = countAndLast(events, "receipt_opened");
  const artifactsCopied = countAndLast(events, "artifact_copied").count;
  const fixesShipped = countAndLast(events, "fix_shipped").count;
  const verifyRuns = countAndLast(events, "verify_run").count;

  let lastActivity: string | null = null;
  for (const r of events) if (!lastActivity || r.at > lastActivity) lastActivity = r.at;

  // Bucket receipt_opened timestamps by the run they opened (props.run_id).
  const opensByRun = new Map<string, string[]>();
  for (const r of events) {
    if (r.event !== "receipt_opened") continue;
    const runId = r.props && typeof r.props.run_id === "string" ? (r.props.run_id as string) : null;
    if (!runId) continue;
    const list = opensByRun.get(runId) ?? [];
    list.push(r.at);
    opensByRun.set(runId, list);
  }

  const nowMs = now.getTime();
  const neverOpened: NeverOpened[] = [];
  for (const a of doneAudits) {
    if (!a.finished_at) continue;
    const finishedMs = new Date(a.finished_at).getTime();
    if (Number.isNaN(finishedMs)) continue;
    const windowEndMs = finishedMs + WINDOW_MS;
    const opens = opensByRun.get(a.id) ?? [];
    // any open within [finished, finished+7d]?
    const openedInWindow = opens.some((at) => {
      const t = new Date(at).getTime();
      return t >= finishedMs && t <= windowEndMs;
    });
    if (!openedInWindow) {
      neverOpened.push({
        runId: a.id,
        finishedAt: a.finished_at,
        windowClosed: nowMs > windowEndMs,
      });
    }
  }
  // Newest-delivered first.
  neverOpened.sort((x, y) => (x.finishedAt < y.finishedAt ? 1 : -1));

  return { receiptsOpened, artifactsCopied, fixesShipped, verifyRuns, lastActivity, neverOpened };
}
