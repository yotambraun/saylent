// The funnel aggregation is the logic worth pinning
// (the DB read is trivial). Covers distinct-identity counting, pct-relative-to-
// signup, the anon-vs-user id fallback, and the zero-filled per-day strip.
import { describe, expect, it } from "vitest";
import {
  activationFunnel,
  eventCounts,
  eventsPerDay,
  FUNNEL_STEPS,
  type AnalyticsRow,
} from "./analytics-funnel";

const NOW = new Date("2026-07-16T12:00:00.000Z");

const rows: AnalyticsRow[] = [
  // user A: signup → onboarding → first audit → receipt → verify (full funnel)
  { event: "signup", at: "2026-07-14T09:00:00.000Z", user_id: "a" },
  { event: "onboarding_started", at: "2026-07-14T09:05:00.000Z", user_id: "a" },
  { event: "first_audit_started", at: "2026-07-14T09:10:00.000Z", user_id: "a" },
  { event: "receipt_opened", at: "2026-07-14T09:20:00.000Z", user_id: "a" },
  { event: "receipt_opened", at: "2026-07-15T10:00:00.000Z", user_id: "a" }, // dup — one distinct user
  { event: "verify_run", at: "2026-07-15T11:00:00.000Z", user_id: "a" },
  // user B: signup → onboarding only (drops off)
  { event: "signup", at: "2026-07-15T08:00:00.000Z", user_id: "b" },
  { event: "onboarding_started", at: "2026-07-15T08:05:00.000Z", user_id: "b" },
  // anon C: signup only (keyed by anon_id when no user_id)
  { event: "signup", at: "2026-07-16T07:00:00.000Z", user_id: null, anon_id: "c" },
];

describe("eventCounts", () => {
  it("counts total occurrences per event (dups included)", () => {
    const c = eventCounts(rows);
    expect(c.signup).toBe(3);
    expect(c.receipt_opened).toBe(2);
    expect(c.verify_run).toBe(1);
    expect(c.purchase).toBeUndefined();
  });
});

describe("activationFunnel", () => {
  it("counts DISTINCT identities per step with pct relative to signup", () => {
    const f = activationFunnel(rows);
    expect(f.map((r) => r.step)).toEqual([...FUNNEL_STEPS]);
    const byStep = Object.fromEntries(f.map((r) => [r.step, r]));
    // 3 signups (A, B, anon C)
    expect(byStep.signup).toEqual({ step: "signup", users: 3, pct: 100 });
    // 2 onboarded (A, B)
    expect(byStep.onboarding_started).toEqual({ step: "onboarding_started", users: 2, pct: 67 });
    // 1 reached first_audit / receipt / verify (A only) — receipt dup collapses
    expect(byStep.first_audit_started.users).toBe(1);
    expect(byStep.receipt_opened.users).toBe(1);
    expect(byStep.verify_run).toEqual({ step: "verify_run", users: 1, pct: 33 });
  });

  it("is all-zero on empty input (no divide-by-zero)", () => {
    const f = activationFunnel([]);
    expect(f.every((r) => r.users === 0 && r.pct === null)).toBe(true);
  });

  it("reports no percentage — not 0% — for a step with users but no signups", () => {
    const f = activationFunnel([{ event: "receipt_opened", at: "2026-07-15T10:00:00.000Z", user_id: "z" }]);
    const receipt = f.find((r) => r.step === "receipt_opened")!;
    expect(receipt.users).toBe(1);
    expect(receipt.pct).toBeNull();
  });
});

describe("eventsPerDay", () => {
  it("returns one zero-filled row per day, newest first", () => {
    const d = eventsPerDay(rows, 3, NOW);
    expect(d.map((r) => r.date)).toEqual(["2026-07-16", "2026-07-15", "2026-07-14"]);
    expect(d[0].total).toBe(1); // 07-16: anon signup
    expect(d[1].total).toBe(4); // 07-15: receipt(a) + purchase(a) + signup(b) + onboarding(b)
    expect(d[1].byEvent.verify_run).toBe(1);
    expect(d[2].total).toBe(4); // 07-14: signup+onboarding+first_audit+receipt (a)
  });

  it("zero-fills a window with no events", () => {
    const d = eventsPerDay([], 2, NOW);
    expect(d).toEqual([
      { date: "2026-07-16", total: 0, byEvent: {} },
      { date: "2026-07-15", total: 0, byEvent: {} },
    ]);
  });
});
