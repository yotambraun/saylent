import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, newPasswordError, resetRedirectUrl } from "./reset";

describe("resetRedirectUrl", () => {
  it("points the emailed link at /auth/callback, which is what mints the session", () => {
    expect(resetRedirectUrl("https://saylent.example")).toBe(
      "https://saylent.example/auth/callback?next=/auth/reset/update",
    );
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(resetRedirectUrl("http://localhost:3000/")).toBe(
      "http://localhost:3000/auth/callback?next=/auth/reset/update",
    );
  });
});

describe("newPasswordError", () => {
  it("accepts a long enough, matching pair", () => {
    expect(newPasswordError("hunter2222", "hunter2222")).toBeNull();
  });

  it("refuses a password under the minimum", () => {
    expect(newPasswordError("short", "short")).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it("refuses a mismatch — a typo here would lock the user out a second time", () => {
    expect(newPasswordError("hunter2222", "hunter2223")).toBe("The two passwords don't match.");
  });
});
