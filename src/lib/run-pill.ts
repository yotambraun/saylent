// Pure derivation of the GlobalRunPill's display state from
// the set of runs the client is tracking (server-seeded active runs + any that
// flip to done/failed while the pill is mounted). Kept pure + framework-free so
// it is unit-tested without a DOM; the client component owns realtime/polling and
// just feeds the current runs in. Also builds the tab-title signal string.
import { parseStage, runProgressPct } from "@saylent/report/run-stages";

export type PillKind = "idle" | "queued" | "running" | "done" | "failed";

export interface PillRun {
  id: string;
  brandName: string;
  stage: string;
  status: string; // queued | running | done | failed
  created_at?: string | null;
}

export interface PillState {
  kind: PillKind;
  /** the run the pill is about (null only when idle) */
  run: PillRun | null;
  /** number of OTHER still-active runs beyond the primary → "+N more" */
  extraCount: number;
  /** where the pill links: the run itself, or /app when several are active */
  href: string;
  /** editorial label to render */
  label: string;
  /** 0–100, meaningful for the running progress bar */
  progressPct: number;
}

const IDLE: PillState = {
  kind: "idle",
  run: null,
  extraCount: 0,
  href: "/app",
  label: "",
  progressPct: 0,
};

function isActive(status: string): boolean {
  return status === "queued" || status === "running";
}

/** Most-recent-first by created_at. Runs without a timestamp sort last but
 * stably. */
function mostRecent(runs: PillRun[]): PillRun[] {
  return [...runs].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

export function derivePillState(runs: PillRun[]): PillState {
  if (!runs || runs.length === 0) return IDLE;
  const sorted = mostRecent(runs);
  const primary = sorted[0];
  // other runs still in flight → the "+N more" tail
  const extraCount = sorted.slice(1).filter((r) => isActive(r.status)).length;
  const brand = primary.brandName || "Your brand";

  let kind: PillKind;
  let label: string;
  switch (primary.status) {
    case "queued":
      kind = "queued";
      label = `${brand} · starting…`;
      break;
    case "done":
      kind = "done";
      label = `✓ ${brand} full report ready →`;
      break;
    case "failed":
      kind = "failed";
      label = `${brand} run failed → retry`;
      break;
    default: {
      // running (or any unknown in-flight state): show the current stage label
      kind = "running";
      const { label: stageLabel } = parseStage(primary.stage);
      label = `${brand} · ${stageLabel || "running"}`;
    }
  }

  // Several active runs → the pill points at the dashboard, not one run.
  const href = extraCount > 0 ? "/app" : `/app/run/${primary.id}`;

  return {
    kind,
    run: primary,
    extraCount,
    href,
    label,
    progressPct: runProgressPct(primary.stage, primary.status),
  };
}

/** Tab-title signal. Returns the title to show while the tab is hidden,
 * or null to keep/restore the page's own title. Suffix mirrors the app's
 * "— Saylent" convention. */
export function tabSignalTitle(state: PillState): string | null {
  if (state.kind === "running") {
    const { label } = parseStage(state.run?.stage);
    return `▶ ${label || "Running"} — Saylent`;
  }
  if (state.kind === "queued") return "▶ Starting… — Saylent";
  if (state.kind === "done") return "✓ Dossier ready — Saylent";
  return null;
}
