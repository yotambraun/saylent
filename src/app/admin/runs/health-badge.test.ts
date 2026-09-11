import { describe, expect, it } from "vitest";
import type { RunHealth } from "@saylent/report/run-health";
import { artifactsLabel, passesRunFilter, runHealthBadge } from "./health-badge";

function health(grade: RunHealth["grade"], over: Partial<RunHealth> = {}): RunHealth {
  return {
    v: 1,
    grade,
    answers: { chatgpt: { got: 10, expected: 10 } },
    zero_citation_answers: 0,
    judge_parse_failures: 0,
    corpus: { fetched: 5, fetch_failures: 0, thin: 0 },
    artifacts: { planned: 3, drafted: 3 },
    weak_result: grade === "weak",
    est_cost_usd: 1.2,
    duration_s: 90,
    notes: [],
    ...over,
  };
}

describe("runHealthBadge", () => {
  it("status=failed always wins, even with an ok health blob", () => {
    const b = runHealthBadge("failed", health("ok"));
    expect(b.kind).toBe("failed");
    expect(b.loud).toBe(true);
    expect(b.problem).toBe(true);
  });

  it("running / queued show an in-flight badge (health ignored while in flight)", () => {
    expect(runHealthBadge("running", null).kind).toBe("running");
    expect(runHealthBadge("queued", null).kind).toBe("queued");
    expect(runHealthBadge("running", null).problem).toBe(false);
  });

  it("done + health present → grade badge with its notes", () => {
    const b = runHealthBadge("done", health("degraded", { notes: ["chatgpt: 0 answers"] }));
    expect(b.kind).toBe("degraded");
    expect(b.loud).toBe(true);
    expect(b.problem).toBe(true);
    expect(b.notes).toEqual(["chatgpt: 0 answers"]);
  });

  it("done + weak → quiet, flagged weak (not a problem)", () => {
    const b = runHealthBadge("done", health("weak"));
    expect(b.kind).toBe("weak");
    expect(b.loud).toBe(false);
    expect(b.problem).toBe(false);
    expect(b.weak).toBe(true);
  });

  it("done + ok → quiet, no problem", () => {
    const b = runHealthBadge("done", health("ok"));
    expect(b.kind).toBe("ok");
    expect(b.loud).toBe(false);
    expect(b.problem).toBe(false);
  });

  it("done + NULL health → honest pre-health gray, never a faked grade", () => {
    const b = runHealthBadge("done", null);
    expect(b.kind).toBe("pre-health");
    expect(b.problem).toBe(false);
    expect(b.weak).toBe(false);
    expect(b.notes).toEqual([]);
  });
});

describe("passesRunFilter", () => {
  const ok = runHealthBadge("done", health("ok"));
  const weak = runHealthBadge("done", health("weak"));
  const degraded = runHealthBadge("done", health("degraded"));
  const failed = runHealthBadge("failed", null);
  const pre = runHealthBadge("done", null);

  it("problemsOnly off → everything passes", () => {
    for (const b of [ok, weak, degraded, failed, pre]) {
      expect(passesRunFilter(b, { problemsOnly: false, includeWeak: false })).toBe(true);
    }
  });

  it("problemsOnly on → only degraded/failed pass; weak & ok drop", () => {
    expect(passesRunFilter(degraded, { problemsOnly: true, includeWeak: false })).toBe(true);
    expect(passesRunFilter(failed, { problemsOnly: true, includeWeak: false })).toBe(true);
    expect(passesRunFilter(ok, { problemsOnly: true, includeWeak: false })).toBe(false);
    expect(passesRunFilter(weak, { problemsOnly: true, includeWeak: false })).toBe(false);
    expect(passesRunFilter(pre, { problemsOnly: true, includeWeak: false })).toBe(false);
  });

  it("includeWeak brings weak rows back in (separate toggle)", () => {
    expect(passesRunFilter(weak, { problemsOnly: true, includeWeak: true })).toBe(true);
    expect(passesRunFilter(ok, { problemsOnly: true, includeWeak: true })).toBe(false);
  });
});

describe("artifactsLabel", () => {
  it("formats drafted/planned", () => {
    expect(artifactsLabel(health("ok"))).toBe("3/3");
    expect(artifactsLabel(health("degraded", { artifacts: { planned: 5, drafted: 2 } }))).toBe("2/5");
  });
  it("null when pre-health", () => {
    expect(artifactsLabel(null)).toBeNull();
  });
});
