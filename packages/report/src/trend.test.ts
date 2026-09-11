// Dashboard trend logic: comparable-series selection,
// three-state noise-aware delta (|Δ rec| ≤ 1 answer = noise, see
// METHODOLOGY.md verify rule), and shape-only sparkline geometry.
import { describe, expect, it } from "vitest";
import { deltaState, engineSeries, runEvents, sparklinePath, trendSeries } from "./trend";

const run = (
  overrides: Partial<{
    kind: string;
    status: string;
    profile: string;
    created_at: string;
    rec: number;
    answered: number;
  }>,
) => ({
  kind: "audit",
  status: "done",
  profile: "full",
  created_at: "2026-07-01T09:00:00Z",
  scores: {
    overall: {
      recommended: overrides.rec ?? 0,
      answered: overrides.answered ?? 48,
      rec_rate: (overrides.rec ?? 0) / (overrides.answered ?? 48),
    },
  },
  ...overrides,
});

describe("trendSeries", () => {
  it("keeps done audits and verifies, drops failed/running", () => {
    const s = trendSeries([
      run({ created_at: "2026-07-03T09:00:00Z", rec: 5 }),
      run({ created_at: "2026-07-02T09:00:00Z", kind: "verify", rec: 4 }),
      run({ created_at: "2026-07-01T09:00:00Z", status: "failed", rec: 9 }),
      run({ created_at: "2026-06-30T09:00:00Z", status: "running", rec: 9 }),
    ]);
    expect(s.map((p) => p.rec)).toEqual([4, 5]); // chronological ascending
  });

  it("only keeps runs matching the latest done run's profile (no smoke/full mixing)", () => {
    const s = trendSeries([
      run({ created_at: "2026-07-03T09:00:00Z", profile: "smoke", rec: 2, answered: 12 }),
      run({ created_at: "2026-07-02T09:00:00Z", profile: "full", rec: 9 }),
      run({ created_at: "2026-07-01T09:00:00Z", profile: "smoke", rec: 1, answered: 12 }),
    ]);
    expect(s.map((p) => p.rec)).toEqual([1, 2]); // latest is smoke → smoke series only
  });

  it("drops runs without scored answers", () => {
    const s = trendSeries([
      run({ created_at: "2026-07-02T09:00:00Z", rec: 3 }),
      { ...run({ created_at: "2026-07-01T09:00:00Z" }), scores: null },
    ]);
    expect(s).toHaveLength(1);
  });

  it("carries the run id onto each point when the source run has one (deep-link)", () => {
    const s = trendSeries([
      { ...run({ created_at: "2026-07-02T09:00:00Z", rec: 4 }), id: "run-b" },
      { ...run({ created_at: "2026-07-01T09:00:00Z", rec: 3 }), id: "run-a" },
    ]);
    expect(s.map((p) => p.id)).toEqual(["run-a", "run-b"]); // ascending, id preserved
  });
});

describe("deltaState", () => {
  it("is 'none' with fewer than two points", () => {
    expect(deltaState([{ rec: 3 }])).toEqual({ state: "none", d: 0 });
    expect(deltaState([])).toEqual({ state: "none", d: 0 });
  });

  it("|Δ| ≤ 1 answer is 'noise', not up/down", () => {
    expect(deltaState([{ rec: 3 }, { rec: 4 }])).toEqual({ state: "noise", d: 1 });
    expect(deltaState([{ rec: 4 }, { rec: 3 }])).toEqual({ state: "noise", d: -1 });
    expect(deltaState([{ rec: 4 }, { rec: 4 }])).toEqual({ state: "noise", d: 0 });
  });

  it("clears the noise band → up/down with the signed answer count", () => {
    expect(deltaState([{ rec: 3 }, { rec: 6 }])).toEqual({ state: "up", d: 3 });
    expect(deltaState([{ rec: 6 }, { rec: 2 }])).toEqual({ state: "down", d: -4 });
  });
});

describe("engineSeries", () => {
  it("extracts one engine's recommended counts from per_engine scores, same-profile runs only", () => {
    const r = (created_at: string, profile: string, rec: number, answered = 3) => ({
      kind: "audit",
      status: "done",
      profile,
      created_at,
      scores: {
        overall: { recommended: rec, answered: answered * 4 },
        per_engine: { chatgpt: { recommended: rec, answered } },
      },
    });
    const s = engineSeries(
      [
        r("2026-07-03T09:00:00Z", "smoke", 2),
        r("2026-07-01T09:00:00Z", "smoke", 1),
        r("2026-07-02T09:00:00Z", "full", 9),
      ],
      "chatgpt",
    );
    expect(s.map((p) => p.rec)).toEqual([1, 2]); // full run excluded, ascending
  });

  it("skips runs where the engine did not answer (answered 0)", () => {
    const s = engineSeries(
      [
        {
          kind: "audit", status: "done", profile: "smoke", created_at: "2026-07-01T09:00:00Z",
          scores: { overall: { recommended: 0, answered: 9 }, per_engine: { chatgpt: { recommended: 0, answered: 0 } } },
        },
      ],
      "chatgpt",
    );
    expect(s).toEqual([]);
  });
});

describe("runEvents", () => {
  const base = (created_at: string, engines: string[], qhash = "h1") => ({
    id: `run-${created_at}`,
    created_at,
    engines,
    question_hash: qhash,
  });

  it("marks an engine-set change when the answering engines differ from the previous run", () => {
    const ev = runEvents([
      base("2026-07-01T09:00:00Z", ["chatgpt", "gemini"]),
      base("2026-07-02T09:00:00Z", ["chatgpt", "gemini", "perplexity"]),
    ]);
    expect(ev).toHaveLength(1);
    expect(ev[0].type).toBe("engine_set");
    expect(ev[0].label).toContain("perplexity joined");
  });

  it("marks a re-baseline when the question hash changes", () => {
    const ev = runEvents([
      base("2026-07-01T09:00:00Z", ["chatgpt"], "h1"),
      base("2026-07-02T09:00:00Z", ["chatgpt"], "h2"),
    ]);
    expect(ev[0].type).toBe("rebaseline");
  });

  it("no events for identical consecutive runs", () => {
    expect(
      runEvents([base("2026-07-01T09:00:00Z", ["chatgpt"]), base("2026-07-02T09:00:00Z", ["chatgpt"])]),
    ).toEqual([]);
  });
});

describe("sparklinePath", () => {
  it("returns null under 3 points (suppression rule)", () => {
    expect(sparklinePath([1, 2], 80, 20)).toBeNull();
    expect(sparklinePath([], 80, 20)).toBeNull();
  });

  it("maps min→bottom and max→top inside the box, last point exposed for the accent dot", () => {
    const p = sparklinePath([0, 10, 5], 80, 20)!;
    const pts = p.points.split(" ").map((s) => s.split(",").map(Number));
    expect(pts[0][1]).toBeGreaterThan(pts[1][1]); // 0 renders lower than 10
    expect(pts).toHaveLength(3);
    expect(p.last).toEqual({ x: pts[2][0], y: pts[2][1] });
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(80);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(20);
    }
  });

  it("renders a flat series as a horizontal midline (no fake drama)", () => {
    const p = sparklinePath([5, 5, 5], 80, 20)!;
    const ys = p.points.split(" ").map((s) => Number(s.split(",")[1]));
    expect(new Set(ys).size).toBe(1);
  });
});
