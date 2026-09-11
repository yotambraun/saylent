// Pins the pure cron scheduling math: eligibility
// + the 24h skip, deterministic jitter, and tz-aware dispatch offsets.
import { describe, expect, it } from "vitest";
import {
  type BrandSchedule,
  JITTER_WINDOW_MS,
  dispatchDelayMs,
  eligibleForMonthlyAudit,
  eligibleForWeeklyVerify,
  isEligible,
  jitterForBrand,
  ranWithinLast24h,
} from "./schedule";

const NOW = Date.parse("2026-07-13T12:00:00Z");

function brand(overrides: Partial<BrandSchedule> = {}): BrandSchedule {
  return {
    brandId: "b1",
    userId: "u1",
    timezone: null,
    hasDoneAudit: true,
    lastRunAt: null,
    ...overrides,
  };
}

describe("ranWithinLast24h", () => {
  it("false for a null / never-run brand", () => {
    expect(ranWithinLast24h(null, NOW)).toBe(false);
  });
  it("true just inside 24h, false just outside", () => {
    expect(ranWithinLast24h(new Date(NOW - 23 * 3600_000).toISOString(), NOW)).toBe(true);
    expect(ranWithinLast24h(new Date(NOW - 25 * 3600_000).toISOString(), NOW)).toBe(false);
  });
  it("false for an unparseable timestamp", () => {
    expect(ranWithinLast24h("not-a-date", NOW)).toBe(false);
  });
});

describe("eligibility", () => {
  it("weekly verify needs a completed audit + no run in 24h (no plans)", () => {
    expect(eligibleForWeeklyVerify(brand(), NOW)).toBe(true);
    expect(eligibleForWeeklyVerify(brand({ hasDoneAudit: false }), NOW)).toBe(false);
    expect(
      eligibleForWeeklyVerify(brand({ lastRunAt: new Date(NOW - 3600_000).toISOString() }), NOW),
    ).toBe(false);
  });

  it("monthly audit needs a completed audit + no run in 24h (no plans)", () => {
    expect(eligibleForMonthlyAudit(brand(), NOW)).toBe(true);
    expect(eligibleForMonthlyAudit(brand({ hasDoneAudit: false }), NOW)).toBe(false);
    expect(
      eligibleForMonthlyAudit(brand({ lastRunAt: new Date(NOW - 3600_000).toISOString() }), NOW),
    ).toBe(false);
  });

  it("isEligible dispatches per kind; a never-audited brand is out for both", () => {
    expect(isEligible(brand({ hasDoneAudit: false }), "verify", NOW)).toBe(false);
    expect(isEligible(brand({ hasDoneAudit: false }), "audit", NOW)).toBe(false);
    expect(isEligible(brand(), "verify", NOW)).toBe(true);
    expect(isEligible(brand(), "audit", NOW)).toBe(true);
  });
});

describe("jitterForBrand", () => {
  it("is deterministic and within [0, window)", () => {
    const a = jitterForBrand("brand-xyz", JITTER_WINDOW_MS);
    const b = jitterForBrand("brand-xyz", JITTER_WINDOW_MS);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(JITTER_WINDOW_MS);
  });
  it("differs across brand ids (spreads a same-timezone cohort)", () => {
    const a = jitterForBrand("brand-a", JITTER_WINDOW_MS);
    const b = jitterForBrand("brand-b", JITTER_WINDOW_MS);
    expect(a).not.toBe(b);
  });
  it("is 0 for a zero window", () => {
    expect(jitterForBrand("x", 0)).toBe(0);
  });
});

describe("dispatchDelayMs", () => {
  // Cron fires Monday 09:00:00 UTC.
  const fire = new Date("2026-07-13T09:00:00Z");

  it("null timezone → UTC: fires at ~09:00 UTC (jitter only)", () => {
    const d = dispatchDelayMs({ brandId: "b1", timezone: null }, fire);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThan(JITTER_WINDOW_MS);
  });

  it("offsets to the customer's LOCAL 09:00 (America/New_York, EDT = UTC-4)", () => {
    // At 09:00 UTC it is 05:00 in New York → 4h until local 09:00.
    const d = dispatchDelayMs({ brandId: "b1", timezone: "America/New_York" }, fire);
    const fourHours = 4 * 60 * 60_000;
    expect(d).toBeGreaterThanOrEqual(fourHours);
    expect(d).toBeLessThan(fourHours + JITTER_WINDOW_MS);
  });

  it("wraps forward when local 09:00 already passed (Asia/Tokyo, UTC+9 = 18:00 local)", () => {
    // 18:00 local → next local 09:00 is 15h away.
    const d = dispatchDelayMs({ brandId: "b1", timezone: "Asia/Tokyo" }, fire);
    const fifteenHours = 15 * 60 * 60_000;
    expect(d).toBeGreaterThanOrEqual(fifteenHours);
    expect(d).toBeLessThan(fifteenHours + JITTER_WINDOW_MS);
  });

  it("falls back to UTC for an invalid timezone (no throw)", () => {
    const d = dispatchDelayMs({ brandId: "b1", timezone: "Not/AZone" }, fire);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThan(JITTER_WINDOW_MS);
  });
});
