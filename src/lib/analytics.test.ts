// The event-name enum is the contract the /api/track
// endpoint validates against; pin it and the type guard so a typo or a dropped
// event surfaces as a failing test, not a silently unrecorded funnel step.
import { describe, expect, it } from "vitest";
import { ANALYTICS_EVENTS, isAnalyticsEvent } from "./analytics";

describe("ANALYTICS_EVENTS", () => {
  it("contains the full activation taxonomy, no dupes", () => {
    expect(new Set(ANALYTICS_EVENTS).size).toBe(ANALYTICS_EVENTS.length);
    for (const e of [
      "signup",
      "onboarding_started",
      "brand_created",
      "first_audit_started",
      "receipt_opened",
      "artifact_copied",
      "fix_shipped",
      "verify_run",
      "share_created",
    ]) {
      expect(ANALYTICS_EVENTS).toContain(e);
    }
  });

  it("carries no commerce event — this app sells nothing", () => {
    for (const gone of ["checkout_started", "purchase"]) {
      expect(ANALYTICS_EVENTS as readonly string[]).not.toContain(gone);
      expect(isAnalyticsEvent(gone)).toBe(false);
    }
  });
});

describe("isAnalyticsEvent", () => {
  it("accepts every enum member", () => {
    for (const e of ANALYTICS_EVENTS) expect(isAnalyticsEvent(e)).toBe(true);
  });

  it("rejects unknown names and non-strings", () => {
    expect(isAnalyticsEvent("page_view")).toBe(false);
    expect(isAnalyticsEvent("")).toBe(false);
    expect(isAnalyticsEvent("SIGNUP")).toBe(false); // case-sensitive
    expect(isAnalyticsEvent(null)).toBe(false);
    expect(isAnalyticsEvent(undefined)).toBe(false);
    expect(isAnalyticsEvent(42)).toBe(false);
    expect(isAnalyticsEvent({ event: "signup" })).toBe(false);
  });
});
