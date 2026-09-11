// Pure spend-aggregation math for the global spend
// dashboard. The DB read is trivial; the bucketing/zero-fill is the logic worth
// pinning.
import { describe, expect, it } from "vitest";
import { dailySpendBuckets, sumSpend, todaySpend, type SpendRun } from "./admin-metrics";

const NOW = new Date("2026-07-16T12:00:00.000Z");

const runs: SpendRun[] = [
  { created_at: "2026-07-16T01:00:00.000Z", est_cost_usd: 2 },
  { created_at: "2026-07-16T23:00:00.000Z", est_cost_usd: "3.5" }, // still 07-16 UTC
  { created_at: "2026-07-15T10:00:00.000Z", est_cost_usd: 1 },
  { created_at: "2026-07-14T10:00:00.000Z", est_cost_usd: null }, // null = 0
  { created_at: "2026-07-10T10:00:00.000Z", est_cost_usd: 9 }, // outside a 3-day window
];

describe("sumSpend", () => {
  it("sums costs, treating null as 0, coercing strings", () => {
    expect(sumSpend(runs)).toBe(15.5);
    expect(sumSpend([])).toBe(0);
  });
});

describe("todaySpend", () => {
  it("sums only the runs on the UTC day of now", () => {
    expect(todaySpend(runs, NOW)).toBe(5.5);
  });
});

describe("dailySpendBuckets", () => {
  it("returns one row per day, newest first, zero-filled", () => {
    const b = dailySpendBuckets(runs, 3, NOW);
    expect(b.map((r) => r.date)).toEqual(["2026-07-16", "2026-07-15", "2026-07-14"]);
    expect(b[0]).toEqual({ date: "2026-07-16", totalUsd: 5.5, count: 2 });
    expect(b[1]).toEqual({ date: "2026-07-15", totalUsd: 1, count: 1 });
    expect(b[2]).toEqual({ date: "2026-07-14", totalUsd: 0, count: 1 });
  });

  it("zero-fills a day with no runs", () => {
    const b = dailySpendBuckets([], 2, NOW);
    expect(b).toEqual([
      { date: "2026-07-16", totalUsd: 0, count: 0 },
      { date: "2026-07-15", totalUsd: 0, count: 0 },
    ]);
  });

  it("excludes runs outside the window", () => {
    const b = dailySpendBuckets(runs, 3, NOW);
    expect(b.some((r) => r.date === "2026-07-10")).toBe(false);
  });
});
