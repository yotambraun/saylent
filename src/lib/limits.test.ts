// Pure cost-control math. The DB pieces (partial unique index enforcing one
// active run per brand; app_settings kill switch) are integration-verified
// against the dev DB — see the reservation note at the bottom. Here we pin the
// config helpers.
import { describe, expect, it } from "vitest";
import {
  DAILY_SPEND_CAP_USD,
  THROTTLE_WINDOW_HOURS,
  brandLimit,
  spendCeilingExceeded,
  throttleCap,
  throttleExceeded,
  throttleWindowStart,
} from "./limits";

describe("brandLimit", () => {
  it("is 5 brands for everyone — self-host friendly, and there are no plan tiers", () => {
    expect(brandLimit()).toBe(5);
  });
});

describe("throttleExceeded", () => {
  it("allows runs below the per-kind cap", () => {
    expect(throttleExceeded("audit", throttleCap("audit") - 1)).toBe(false);
    expect(throttleExceeded("verify", 0)).toBe(false);
  });

  it("blocks at and over the cap", () => {
    expect(throttleExceeded("audit", throttleCap("audit"))).toBe(true);
    expect(throttleExceeded("verify", throttleCap("verify") + 5)).toBe(true);
  });
});

describe("throttleWindowStart", () => {
  it("is exactly the window length before now", () => {
    const now = 1_000_000_000_000;
    const start = new Date(throttleWindowStart(now)).getTime();
    expect(now - start).toBe(THROTTLE_WINDOW_HOURS * 3600_000);
  });
});

describe("spendCeilingExceeded", () => {
  it("trips at and over the cap", () => {
    expect(spendCeilingExceeded(DAILY_SPEND_CAP_USD)).toBe(true);
    expect(spendCeilingExceeded(DAILY_SPEND_CAP_USD + 1)).toBe(true);
  });

  it("stays clear below the cap", () => {
    expect(spendCeilingExceeded(DAILY_SPEND_CAP_USD - 0.01)).toBe(false);
    expect(spendCeilingExceeded(0)).toBe(false);
  });

  it("respects an explicit per-instance cap", () => {
    expect(spendCeilingExceeded(10, 5)).toBe(true);
    expect(spendCeilingExceeded(3, 5)).toBe(false);
  });

  it("never trips on a zero/disabled cap", () => {
    expect(spendCeilingExceeded(999, 0)).toBe(false);
  });
});

// --- Atomic reservation: integration proof (documented, not unit-run) ---
// The double-audit TOCTOU is killed at the DB, so a unit test cannot exercise it
// meaningfully. Migration 0024 creates:
//   create unique index runs_one_active_per_brand
//     on public.runs (brand_id) where status in ('queued','running');
// Two concurrent createRun calls both pass the in-app pre-check, both attempt the
// insert; the DB lets exactly one succeed and rejects the other with SQLSTATE
// 23505, which createRun maps to "A run is already in progress for this brand."
// Reproduce against the dev DB (psql), no LLM spend:
//   BEGIN; insert into runs(brand_id,user_id,kind,status) values (:b,:u,'audit','queued'); -- tx A
//   -- in a second session, the same insert blocks then fails with 23505 on A's COMMIT.
