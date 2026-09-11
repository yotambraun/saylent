// THE PULSE — pure selection + view-model tests. Covers pickComparablePair's
// comparability gates (done-only, same-profile, same frozen question key, verify
// runs included) and its "newest comparable, skip incomparable" selection, plus
// pulseView's card cap and honest stable count.
import { describe, expect, it } from "vitest";
import type { AnswerDiff } from "./answer-diff";
import {
  areRunsComparable,
  comparableRunIds,
  pickComparablePair,
  pulseView,
  validateChosenPair,
  type PulseRun,
} from "./pulse";

const run = (over: Partial<PulseRun> & { id: string }): PulseRun => ({
  kind: "audit",
  status: "done",
  profile: "full",
  created_at: "2026-07-01T09:00:00Z",
  ...over,
});

// same key for the whole frozen set unless a test overrides it
const KEYS = (...ids: string[]): Record<string, string> =>
  Object.fromEntries(ids.map((id) => [id, "q01:Best tool?|q02:Alternatives?"]));

describe("pickComparablePair", () => {
  it("returns null with a single done run", () => {
    expect(pickComparablePair([run({ id: "a" })], KEYS("a"))).toBeNull();
  });

  it("returns null when there are no runs", () => {
    expect(pickComparablePair([], {})).toBeNull();
  });

  it("picks the two most-recent comparable runs (current = newest)", () => {
    const pair = pickComparablePair(
      [
        run({ id: "old", created_at: "2026-07-01T09:00:00Z" }),
        run({ id: "new", created_at: "2026-07-03T09:00:00Z" }),
        run({ id: "mid", created_at: "2026-07-02T09:00:00Z" }),
      ],
      KEYS("old", "mid", "new"),
    );
    expect(pair).toEqual({ baselineRunId: "mid", currentRunId: "new" });
  });

  it("never pairs runs of different profiles (no smoke/full mixing)", () => {
    const pair = pickComparablePair(
      [
        run({ id: "smoke", profile: "smoke", created_at: "2026-07-02T09:00:00Z" }),
        run({ id: "full", profile: "full", created_at: "2026-07-01T09:00:00Z" }),
      ],
      KEYS("smoke", "full"),
    );
    expect(pair).toBeNull();
  });

  it("never pairs runs whose question set differs (a re-baseline breaks comparability)", () => {
    const pair = pickComparablePair(
      [
        run({ id: "new", created_at: "2026-07-02T09:00:00Z" }),
        run({ id: "old", created_at: "2026-07-01T09:00:00Z" }),
      ],
      { new: "q01:v2|q02:v2", old: "q01:v1|q02:v1" },
    );
    expect(pair).toBeNull();
  });

  it("skips a newer incomparable run to pair two older comparable ones", () => {
    // newest run is a lone smoke re-baseline with no comparable partner; the
    // panel falls back to the two older same-profile, same-key runs.
    const pair = pickComparablePair(
      [
        run({ id: "lonely", profile: "smoke", created_at: "2026-07-03T09:00:00Z" }),
        run({ id: "mid", profile: "full", created_at: "2026-07-02T09:00:00Z" }),
        run({ id: "old", profile: "full", created_at: "2026-07-01T09:00:00Z" }),
      ],
      { lonely: "smoke-only-key", ...KEYS("mid", "old") },
    );
    expect(pair).toEqual({ baselineRunId: "old", currentRunId: "mid" });
  });

  it("only considers done runs (a running/failed run is never the baseline or current)", () => {
    const pair = pickComparablePair(
      [
        run({ id: "running", status: "running", created_at: "2026-07-03T09:00:00Z" }),
        run({ id: "done", status: "done", created_at: "2026-07-02T09:00:00Z" }),
        run({ id: "failed", status: "failed", created_at: "2026-07-01T09:00:00Z" }),
      ],
      KEYS("running", "done", "failed"),
    );
    // only one done run remains → no pair
    expect(pair).toBeNull();
  });

  it("pairs an audit baseline with a verify current because a verify reuses the frozen set", () => {
    const pair = pickComparablePair(
      [
        run({ id: "verify", kind: "verify", created_at: "2026-07-02T09:00:00Z" }),
        run({ id: "audit", kind: "audit", created_at: "2026-07-01T09:00:00Z" }),
      ],
      KEYS("verify", "audit"),
    );
    expect(pair).toEqual({ baselineRunId: "audit", currentRunId: "verify" });
  });

  it("excludes a run that has no known question key (comparability can't be established)", () => {
    const pair = pickComparablePair(
      [
        run({ id: "current", created_at: "2026-07-02T09:00:00Z" }),
        run({ id: "keyless", created_at: "2026-07-01T09:00:00Z" }),
      ],
      KEYS("current"), // "keyless" absent from the map
    );
    expect(pair).toBeNull();
  });

  it("is deterministic on a created_at tie (tie-break by id)", () => {
    const pair = pickComparablePair(
      [
        run({ id: "a", created_at: "2026-07-02T09:00:00Z" }),
        run({ id: "b", created_at: "2026-07-02T09:00:00Z" }),
      ],
      KEYS("a", "b"),
    );
    // ids sort descending → "b" is current, "a" is baseline; stable every call
    expect(pair).toEqual({ baselineRunId: "a", currentRunId: "b" });
  });
});

describe("areRunsComparable (the honesty predicate the picker reuses)", () => {
  it("true for two done, same-profile, same-key runs", () => {
    const a = run({ id: "a", created_at: "2026-07-01T09:00:00Z" });
    const b = run({ id: "b", created_at: "2026-07-02T09:00:00Z" });
    expect(areRunsComparable(a, b, KEYS("a", "b"))).toBe(true);
  });

  it("false across a profile boundary (smoke vs full)", () => {
    const a = run({ id: "a", profile: "smoke" });
    const b = run({ id: "b", profile: "full" });
    expect(areRunsComparable(a, b, KEYS("a", "b"))).toBe(false);
  });

  it("false across a re-baseline (different question keys)", () => {
    const a = run({ id: "a" });
    const b = run({ id: "b" });
    expect(areRunsComparable(a, b, { a: "q01:v1", b: "q01:v2" })).toBe(false);
  });

  it("false when either run is not done, or is keyless, or is the same run", () => {
    const a = run({ id: "a" });
    const b = run({ id: "b" });
    expect(areRunsComparable(a, run({ id: "b", status: "running" }), KEYS("a", "b"))).toBe(false);
    expect(areRunsComparable(a, b, KEYS("a"))).toBe(false); // b keyless
    expect(areRunsComparable(a, a, KEYS("a"))).toBe(false); // identical id
  });
});

describe("comparableRunIds (picker options — every offered run has a partner)", () => {
  it("returns all runs of a single comparable group, newest first", () => {
    const ids = comparableRunIds(
      [
        run({ id: "old", created_at: "2026-07-01T09:00:00Z" }),
        run({ id: "new", created_at: "2026-07-03T09:00:00Z" }),
        run({ id: "mid", created_at: "2026-07-02T09:00:00Z" }),
      ],
      KEYS("old", "mid", "new"),
    );
    expect(ids).toEqual(["new", "mid", "old"]);
  });

  it("drops a run that has no honest partner (a lone smoke re-baseline)", () => {
    const ids = comparableRunIds(
      [
        run({ id: "lonely", profile: "smoke", created_at: "2026-07-03T09:00:00Z" }),
        run({ id: "mid", profile: "full", created_at: "2026-07-02T09:00:00Z" }),
        run({ id: "old", profile: "full", created_at: "2026-07-01T09:00:00Z" }),
      ],
      { lonely: "smoke-only-key", ...KEYS("mid", "old") },
    );
    expect(ids).toEqual(["mid", "old"]);
  });

  it("returns [] when no two runs are comparable", () => {
    expect(comparableRunIds([run({ id: "a" })], KEYS("a"))).toEqual([]);
  });
});

describe("validateChosenPair (?a=&b= override, same predicate)", () => {
  const runs = [
    run({ id: "old", created_at: "2026-07-01T09:00:00Z" }),
    run({ id: "mid", created_at: "2026-07-02T09:00:00Z" }),
    run({ id: "new", created_at: "2026-07-03T09:00:00Z" }),
  ];
  const keys = KEYS("old", "mid", "new");

  it("orders a valid pair older→newer regardless of a/b argument order", () => {
    expect(validateChosenPair("new", "old", runs, keys)).toEqual({
      baselineRunId: "old",
      currentRunId: "new",
    });
    expect(validateChosenPair("old", "new", runs, keys)).toEqual({
      baselineRunId: "old",
      currentRunId: "new",
    });
  });

  it("rejects a missing param, identical ids, or an unknown run id", () => {
    expect(validateChosenPair(undefined, "new", runs, keys)).toBeNull();
    expect(validateChosenPair("new", "new", runs, keys)).toBeNull();
    expect(validateChosenPair("new", "ghost", runs, keys)).toBeNull();
  });

  it("rejects an incomparable but valid pair (falls back to auto in the caller)", () => {
    const mixed = [
      run({ id: "s", profile: "smoke", created_at: "2026-07-02T09:00:00Z" }),
      run({ id: "f", profile: "full", created_at: "2026-07-01T09:00:00Z" }),
    ];
    expect(validateChosenPair("s", "f", mixed, KEYS("s", "f"))).toBeNull();
  });
});

const diff = (over: Partial<AnswerDiff> = {}): AnswerDiff => ({
  qid: "q01",
  engine: "chatgpt",
  question: "Best tool?",
  added: [],
  removed: [],
  brandTouched: false,
  ...over,
});

describe("pulseView", () => {
  it("caps the display at 6 cards while preserving diffRuns' order", () => {
    const diffs = Array.from({ length: 8 }, (_, i) => diff({ qid: `q${i}` }));
    const view = pulseView(diffs, { pairedCount: 20 });
    expect(view.cards).toHaveLength(6);
    expect(view.cards.map((c) => c.qid)).toEqual(["q0", "q1", "q2", "q3", "q4", "q5"]);
    expect(view.changedCount).toBe(8);
  });

  it("reports stableCount as compared answers minus changed ones", () => {
    const view = pulseView([diff(), diff({ qid: "q02" })], { pairedCount: 10 });
    expect(view.changedCount).toBe(2);
    expect(view.stableCount).toBe(8);
  });

  it("returns no cards and the full paired count as stable when nothing moved", () => {
    const view = pulseView([], { pairedCount: 12 });
    expect(view.cards).toEqual([]);
    expect(view.changedCount).toBe(0);
    expect(view.stableCount).toBe(12);
  });

  it("never reports a negative stable count", () => {
    const view = pulseView([diff(), diff(), diff()], { pairedCount: 1 });
    expect(view.stableCount).toBe(0);
  });

  it("honours a custom cardCap", () => {
    const diffs = Array.from({ length: 5 }, (_, i) => diff({ qid: `q${i}` }));
    expect(pulseView(diffs, { pairedCount: 5, cardCap: 3 }).cards).toHaveLength(3);
  });
});
