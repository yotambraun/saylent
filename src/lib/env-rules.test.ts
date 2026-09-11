import { describe, expect, it } from "vitest";
import { inngestKeysRequired } from "./env-rules";

describe("inngestKeysRequired", () => {
  it("requires the Inngest keys on a production deployment", () => {
    expect(inngestKeysRequired({ VERCEL_ENV: "production" })).toBe(true);
  });
  it("does not require them outside production (the local dev server needs none)", () => {
    expect(inngestKeysRequired({ VERCEL_ENV: "preview" })).toBe(false);
    expect(inngestKeysRequired({})).toBe(false);
  });
  it("does not require them on the read-only demo, which runs nothing", () => {
    expect(inngestKeysRequired({ VERCEL_ENV: "production", NEXT_PUBLIC_DEMO_READONLY: "1" })).toBe(false);
  });
});
