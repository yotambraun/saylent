// "WHAT'S FOLLOWING YOU" — Living-Asset composition tests. Multi-run fixtures
// exercise: a STABLE rival (Jira, ~1-in-5 share across every audit), a RISING
// rival (share climbing past the threshold), a ONE-OFF rival (present once →
// excluded), PERSISTENT + one-off objections, the brand excluded from its own
// rivals, and non-comparable runs (smoke profile + a re-baseline) never joining
// the cohort or polluting the shares.
import { describe, expect, it } from "vitest";
import { comparableCohort, computeFollowing, type FollowingAnswerRow } from "./following";
import type { PulseRun } from "./pulse";

const run = (over: Partial<PulseRun> & { id: string; created_at: string }): PulseRun => ({
  kind: "audit",
  status: "done",
  profile: "full",
  ...over,
});

// Three comparable full audits (Q1) + one smoke run + one re-baselined run (Q2).
const RUNS: PulseRun[] = [
  run({ id: "r1", created_at: "2026-01-01T00:00:00Z" }),
  run({ id: "r2", created_at: "2026-02-01T00:00:00Z" }),
  run({ id: "r3", created_at: "2026-03-01T00:00:00Z" }),
  run({ id: "smoke", created_at: "2026-04-01T00:00:00Z", profile: "smoke" }),
  run({ id: "rebase", created_at: "2026-05-01T00:00:00Z" }),
];
const KEYS: Record<string, string> = {
  r1: "Q1",
  r2: "Q1",
  r3: "Q1",
  smoke: "Q1", // same key but smoke profile ⇒ not comparable to the full runs
  rebase: "Q2", // re-baselined question set ⇒ no comparable partner
};

// build the other_brands array for a run: names repeated = mention count.
const rivals = (counts: Record<string, number>): { name: string; why: string }[] =>
  Object.entries(counts).flatMap(([name, n]) =>
    Array.from({ length: n }, () => ({ name, why: "" })),
  );
const risks = (...texts: string[]) => texts.map((text) => ({ text, kind: "risk" as const }));

// One answer row per run carrying that run's full rival-mention bag + risk set.
// Rival totals are 10 per full run so shares read cleanly.
const ANSWERS: FollowingAnswerRow[] = [
  // r1 (oldest): Jira 2/10 = .20 · Monday absent · 8 distinct one-offs
  {
    run_id: "r1",
    other_brands: rivals({ Jira: 2, a1: 1, a2: 1, a3: 1, a4: 1, a5: 1, a6: 1, a7: 1, a8: 1 }),
    claims: risks("Slow performance on large boards", "Limited integrations"),
  },
  // r2: Jira 2/10 = .20 · Monday 2/10 = .20 · one-offs + a one-off objection
  {
    run_id: "r2",
    other_brands: rivals({ Jira: 2, Monday: 2, b1: 1, b2: 1, b3: 1, b4: 1, b5: 1, b6: 1 }),
    claims: risks("Slow performance on large boards", "Limited integrations", "One-time hiccup"),
  },
  // r3 (newest): Jira 2/10 = .20 · Monday 3/10 = .30 (rising) · brand's own name
  // must be dropped · one-offs
  {
    run_id: "r3",
    other_brands: rivals({ Jira: 2, Monday: 3, Trackflow: 4, c1: 1, c2: 1, c3: 1, c4: 1, c5: 1 }),
    claims: risks("Slow performance on large boards"),
  },
  // smoke + rebase carry huge Jira noise — must be IGNORED (not in the cohort).
  { run_id: "smoke", other_brands: rivals({ Jira: 99 }), claims: risks("Fake smoke objection") },
  { run_id: "rebase", other_brands: rivals({ Jira: 99 }), claims: risks("Fake rebase objection") },
];

describe("comparableCohort", () => {
  it("picks the newest full-audit group, newest-first, and excludes smoke + re-baseline", () => {
    expect(comparableCohort(RUNS, KEYS)).toEqual(["r3", "r2", "r1"]);
  });
  it("returns [] with fewer than two comparable runs", () => {
    expect(comparableCohort([RUNS[0]], { r1: "Q1" })).toEqual([]);
  });
});

describe("computeFollowing", () => {
  const view = computeFollowing(RUNS, KEYS, ANSWERS, ["Trackflow"])!;

  it("returns a view over the three-run cohort", () => {
    expect(view).not.toBeNull();
    expect(view.cohortRunIds).toEqual(["r3", "r2", "r1"]);
  });

  it("surfaces Jira as the stable most-named alternative at ~1 in 5", () => {
    const jira = view.rivals.find((r) => r.name === "Jira")!;
    expect(jira).toBeTruthy();
    expect(jira.runsPresent).toBe(3);
    expect(jira.avgShare).toBeCloseTo(0.2, 5);
    expect(jira.sentence).toBe(
      "Jira has been your most-named alternative in all 3 audits (~1 in 5 rival mentions).",
    );
  });

  it("flags the rising rival with a direction, present in only 2 audits", () => {
    const monday = view.rivals.find((r) => r.name === "Monday")!;
    expect(monday.runsPresent).toBe(2);
    expect(monday.sentence).toContain("2 of 3 audits");
    expect(monday.sentence).toContain("climbing");
    expect(monday.sentence).toContain("a recurring alternative");
  });

  it("excludes one-off rivals and the audited brand itself", () => {
    const names = view.rivals.map((r) => r.name);
    expect(names).toEqual(["Jira", "Monday"]); // a1.. / b1.. one-offs dropped
    expect(names).not.toContain("Trackflow"); // brand is not its own rival
  });

  it("does NOT let smoke/re-baseline runs pollute the shares", () => {
    // If the smoke/rebase Jira×99 leaked in, Jira's share would swing wildly.
    const jira = view.rivals.find((r) => r.name === "Jira")!;
    expect(jira.avgShare).toBeCloseTo(0.2, 5);
  });

  it("surfaces persistent objections and drops the one-off", () => {
    const claims = view.objections.map((o) => o.claim);
    expect(claims).toContain("Slow performance on large boards");
    expect(claims).toContain("Limited integrations");
    expect(claims).not.toContain("One-time hiccup"); // present in only one audit
    expect(claims).not.toContain("Fake smoke objection");
    expect(claims).not.toContain("Fake rebase objection");
  });

  it("phrases an every-audit objection as 'all N'", () => {
    const slow = view.objections.find((o) => o.claim === "Slow performance on large boards")!;
    expect(slow.runsPresent).toBe(3);
    expect(slow.sentence).toBe(
      'The "Slow performance on large boards" objection has appeared in all 3 audits. Still unaddressed.',
    );
  });

  it("phrases a 2-of-3 objection honestly", () => {
    const lim = view.objections.find((o) => o.claim === "Limited integrations")!;
    expect(lim.runsPresent).toBe(2);
    expect(lim.sentence).toContain("2 of 3 audits");
  });

  it("returns null when there are fewer than two comparable audits", () => {
    expect(computeFollowing([RUNS[0]], { r1: "Q1" }, ANSWERS, ["Trackflow"])).toBeNull();
  });

  it("returns null when nothing recurs across the cohort", () => {
    // two comparable runs, but every rival/objection appears in just one of them
    const runs2: PulseRun[] = [
      run({ id: "x", created_at: "2026-01-01T00:00:00Z" }),
      run({ id: "y", created_at: "2026-02-01T00:00:00Z" }),
    ];
    const keys2 = { x: "Q1", y: "Q1" };
    const ans2: FollowingAnswerRow[] = [
      { run_id: "x", other_brands: rivals({ Alpha: 3 }), claims: risks("only in x") },
      { run_id: "y", other_brands: rivals({ Beta: 3 }), claims: risks("only in y") },
    ];
    expect(computeFollowing(runs2, keys2, ans2, [])).toBeNull();
  });

  it("normalizes objection text (whitespace/case) for the exact-match tier", () => {
    const runs2: PulseRun[] = [
      run({ id: "x", created_at: "2026-01-01T00:00:00Z" }),
      run({ id: "y", created_at: "2026-02-01T00:00:00Z" }),
    ];
    const keys2 = { x: "Q1", y: "Q1" };
    const ans2: FollowingAnswerRow[] = [
      { run_id: "x", other_brands: [], claims: risks("Pricing  is  Steep") },
      { run_id: "y", other_brands: [], claims: risks("pricing is steep") },
    ];
    const v = computeFollowing(runs2, keys2, ans2, [])!;
    expect(v.objections).toHaveLength(1);
    expect(v.objections[0].runsPresent).toBe(2);
  });
});
