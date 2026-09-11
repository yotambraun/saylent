// Hosted read-only demo — the demo switch + write guard.
// These are the two invariants the whole demo rests on: OFF is byte-for-byte the
// normal product (assertNotDemo returns null), ON refuses every mutation.
import { describe, expect, it } from "vitest";
import {
  DEMO_READ_ONLY_MESSAGE,
  DEMO_SESSION_MAX_AGE_SECONDS,
  assertNotDemo,
  clampDemoSessionCookie,
  demoCredentials,
  isDemoReadOnly,
} from "./demo-mode";

describe("isDemoReadOnly", () => {
  it("is ON for the documented truthy values", () => {
    for (const v of ["1", "true", "TRUE", " on ", "yes"]) {
      expect(isDemoReadOnly(v), v).toBe(true);
    }
  });

  it("is OFF when unset, empty, or anything else (fail-safe, not fail-open)", () => {
    for (const v of [undefined, "", "  ", "0", "false", "off", "no", "maybe"]) {
      expect(isDemoReadOnly(v), String(v)).toBe(false);
    }
  });
});

describe("demoCredentials", () => {
  it("returns the shared demo account when both vars are set", () => {
    expect(demoCredentials("demo@example.com", "pw")).toEqual({
      email: "demo@example.com",
      password: "pw",
    });
  });

  it("trims the email", () => {
    expect(demoCredentials("  demo@example.com  ", "pw")?.email).toBe("demo@example.com");
  });

  it("fails closed when either var is missing — the proxy then never signs anyone in", () => {
    expect(demoCredentials(undefined, "pw")).toBeNull();
    expect(demoCredentials("demo@example.com", undefined)).toBeNull();
    expect(demoCredentials("", "pw")).toBeNull();
    expect(demoCredentials("demo@example.com", "")).toBeNull();
  });
});

describe("assertNotDemo", () => {
  it("returns null on a normal deployment — every mutation falls straight through", () => {
    for (const v of [undefined, "", "0", "false"]) {
      expect(assertNotDemo(v), String(v)).toBeNull();
    }
  });

  it("blocks with one honest message on a demo deployment", () => {
    const blocked = assertNotDemo("1");
    expect(blocked).not.toBeNull();
    expect(blocked!.ok).toBe(false);
    expect(blocked!.demo).toBe(true);
    // Both keys, so ONE object satisfies the server-action ({error}) and the
    // createRun / /api/runs ({reason}) contracts without widening either.
    expect(blocked!.error).toBe(DEMO_READ_ONLY_MESSAGE);
    expect(blocked!.reason).toBe(DEMO_READ_ONLY_MESSAGE);
  });

  it("tells the visitor what to do instead of just saying no", () => {
    expect(DEMO_READ_ONLY_MESSAGE).toContain("read-only demo");
    expect(DEMO_READ_ONLY_MESSAGE).toContain("npx saylent audit");
  });
});

// A minted demo session must not outlive the flag.
describe("clampDemoSessionCookie", () => {
  it("caps a month-long Supabase cookie at one hour", () => {
    expect(clampDemoSessionCookie({ maxAge: 60 * 60 * 24 * 30 }).maxAge).toBe(
      DEMO_SESSION_MAX_AGE_SECONDS,
    );
    expect(DEMO_SESSION_MAX_AGE_SECONDS).toBeLessThanOrEqual(3600);
  });

  it("keeps a shorter lifetime as asked", () => {
    expect(clampDemoSessionCookie({ maxAge: 300 }).maxAge).toBe(300);
  });

  it("gives an unspecified lifetime the cap rather than leaving it open", () => {
    expect(clampDemoSessionCookie(undefined).maxAge).toBe(DEMO_SESSION_MAX_AGE_SECONDS);
    expect(clampDemoSessionCookie({ path: "/", maxAge: undefined }).maxAge).toBe(
      DEMO_SESSION_MAX_AGE_SECONDS,
    );
  });

  it("keeps every other cookie attribute, and pulls `expires` back in line", () => {
    const now = Date.UTC(2026, 8, 10, 12, 0, 0);
    const out = clampDemoSessionCookie(
      {
        maxAge: 60 * 60 * 24 * 30,
        expires: new Date(now + 60 * 60 * 24 * 30 * 1000),
        path: "/",
        httpOnly: true,
        sameSite: "lax" as const,
      },
      now,
    );
    expect(out.path).toBe("/");
    expect(out.httpOnly).toBe(true);
    expect(out.sameSite).toBe("lax");
    expect(out.expires?.getTime()).toBe(now + DEMO_SESSION_MAX_AGE_SECONDS * 1000);
  });
});
