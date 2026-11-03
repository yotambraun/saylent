import { describe, expect, it } from "vitest";
import { open, seal, sealingAvailable } from "./secret-box";

const env = (APP_SECRET?: string) => ({ APP_SECRET }) as unknown as NodeJS.ProcessEnv;

describe("secret-box", () => {
  it("round-trips under the same APP_SECRET and never stores the plaintext", () => {
    const s = seal("https://hooks.slack.com/services/T/B/secret", env("a-long-enough-app-secret"));
    expect(s).toMatch(/^v1\./);
    expect(s).not.toContain("hooks.slack.com");
    expect(open(s, env("a-long-enough-app-secret"))).toBe("https://hooks.slack.com/services/T/B/secret");
  });

  it("opens nothing under a rotated or missing secret, or a tampered value", () => {
    const s = seal("x", env("a-long-enough-app-secret"));
    expect(open(s, env("another-long-app-secret!"))).toBeNull();
    expect(open(s, env(undefined))).toBeNull();
    expect(open(`${s.slice(0, -2)}AA`, env("a-long-enough-app-secret"))).toBeNull();
  });

  it("is off without a 16+ character APP_SECRET", () => {
    expect(sealingAvailable(env("short"))).toBe(false);
    expect(() => seal("x", env(undefined))).toThrow(/APP_SECRET/);
  });
});
