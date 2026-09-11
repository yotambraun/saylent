// relativeTime formatter. Pure; $0.
import { describe, expect, it } from "vitest";
import { relativeTime } from "./relative-time";

const NOW = Date.parse("2026-07-10T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("relativeTime", () => {
  it("under 45s ⇒ just now", () => {
    expect(relativeTime(ago(10_000), NOW)).toBe("just now");
  });
  it("minutes", () => {
    expect(relativeTime(ago(5 * 60_000), NOW)).toBe("5m");
  });
  it("hours", () => {
    expect(relativeTime(ago(3 * 3_600_000), NOW)).toBe("3h");
  });
  it("days", () => {
    expect(relativeTime(ago(2 * 86_400_000), NOW)).toBe("2d");
  });
  it("≥7d ⇒ a date", () => {
    expect(relativeTime(ago(10 * 86_400_000), NOW)).toMatch(/\d{2} \w{3}/);
  });
  it("garbage ⇒ empty string, never throws", () => {
    expect(relativeTime("not-a-date", NOW)).toBe("");
  });
});
