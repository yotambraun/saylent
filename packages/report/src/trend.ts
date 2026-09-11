// Pure trend logic for the dashboard (and later the
// Movement page). Honesty rules encoded here:
// - never mix profiles in one series (6-question smoke vs 20-question full);
// - |Δ recommended| ≤ 1 answer = within noise (see METHODOLOGY.md verify rule);
// - sparklines are shape-only and suppressed under 3 points.

export interface TrendRun {
  /** optional: present when the caller wants series points to link back to
   *  their run (Movement chart dots + table rows). Pure logic ignores it. */
  id?: string;
  kind: string;
  status: string;
  profile: string;
  created_at: string;
  scores: {
    overall?: { recommended: number; answered: number } | null;
    per_engine?: Record<string, { recommended: number; answered: number } | undefined>;
  } | null;
}

export interface TrendPoint {
  /** run id when the source TrendRun carried one — lets a point deep-link. */
  id?: string;
  t: string;
  rec: number;
  answered: number;
}

/** Done audits+verifies with scores, restricted to the latest run's profile,
 *  chronological ascending. Input order doesn't matter. */
export function trendSeries(runs: TrendRun[]): TrendPoint[] {
  const done = runs
    .filter(
      (r) =>
        r.status === "done" &&
        (r.kind === "audit" || r.kind === "verify") &&
        (r.scores?.overall?.answered ?? 0) > 0,
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const latest = done[done.length - 1];
  if (!latest) return [];
  return done
    .filter((r) => r.profile === latest.profile)
    .map((r) => ({
      id: r.id,
      t: r.created_at,
      rec: r.scores!.overall!.recommended,
      answered: r.scores!.overall!.answered,
    }));
}

/** One engine's recommended counts over the same-profile done runs; runs where
 *  the engine answered nothing are skipped (a missing key ≠ a zero score). */
export function engineSeries(runs: TrendRun[], engine: string): TrendPoint[] {
  const done = runs
    .filter(
      (r) =>
        r.status === "done" &&
        (r.kind === "audit" || r.kind === "verify") &&
        (r.scores?.overall?.answered ?? 0) > 0,
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const latest = done[done.length - 1];
  if (!latest) return [];
  return done
    .filter((r) => r.profile === latest.profile)
    .flatMap((r) => {
      const e = r.scores?.per_engine?.[engine];
      if (!e || e.answered === 0) return [];
      return [{ id: r.id, t: r.created_at, rec: e.recommended, answered: e.answered }];
    });
}

export interface RunEventInput {
  id: string;
  created_at: string;
  /** engines that actually answered in this run */
  engines: string[];
  /** stable hash of the run's question set (qid+text) — re-baseline detector */
  question_hash: string;
}

export interface RunEvent {
  run_id: string;
  t: string;
  type: "engine_set" | "rebaseline" | "fix";
  label: string;
}

/** Comparability events between consecutive runs — rendered as rim markers and
 *  (for rebaseline) a line break: points across them aren't comparable. */
export function runEvents(runs: RunEventInput[]): RunEvent[] {
  const sorted = [...runs].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const out: RunEvent[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.question_hash !== prev.question_hash) {
      out.push({
        run_id: cur.id,
        t: cur.created_at,
        type: "rebaseline",
        label: "questions re-baselined: earlier points not comparable",
      });
    }
    const joined = cur.engines.filter((e) => !prev.engines.includes(e));
    const left = prev.engines.filter((e) => !cur.engines.includes(e));
    if (joined.length > 0 || left.length > 0) {
      const parts = [
        ...(joined.length ? [`${joined.join(", ")} joined`] : []),
        ...(left.length ? [`${left.join(", ")} dropped`] : []),
      ];
      out.push({
        run_id: cur.id,
        t: cur.created_at,
        type: "engine_set",
        label: `engine coverage changed: ${parts.join("; ")}`,
      });
    }
  }
  return out;
}

/** Three-state delta over the last two points of a series. */
export function deltaState(series: { rec: number }[]): {
  state: "up" | "down" | "noise" | "none";
  d: number;
} {
  if (series.length < 2) return { state: "none", d: 0 };
  const d = series[series.length - 1].rec - series[series.length - 2].rec;
  if (Math.abs(d) <= 1) return { state: "noise", d };
  return { state: d > 0 ? "up" : "down", d };
}

/** Shape-only polyline geometry; null under 3 points (suppression rule). */
export function sparklinePath(
  values: number[],
  width: number,
  height: number,
): { points: string; last: { x: number; y: number } } | null {
  if (values.length < 3) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => ({
    x: Math.round(i * step * 100) / 100,
    y:
      span === 0
        ? height / 2
        : Math.round((height - ((v - min) / span) * height) * 100) / 100,
  }));
  return {
    points: pts.map((p) => `${p.x},${p.y}`).join(" "),
    last: pts[pts.length - 1],
  };
}
