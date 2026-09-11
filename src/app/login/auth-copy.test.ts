import { describe, expect, it } from "vitest";
import { authErrorCopy } from "./auth-copy";

describe("authErrorCopy", () => {
  it("turns the raw Supabase sign-in error into product copy that names the next step", () => {
    const copy = authErrorCopy("Invalid login credentials", "signin");
    expect(copy).not.toContain("Invalid login credentials");
    expect(copy).toMatch(/don’t match/);
    expect(copy).toMatch(/Create an account/);
  });

  it("explains an unconfirmed email", () => {
    expect(authErrorCopy("Email not confirmed", "signin")).toMatch(/Confirm your email/);
  });

  it("points a duplicate signup at sign-in", () => {
    expect(authErrorCopy("User already registered", "signup")).toMatch(/already has an account/);
  });

  it("names SMTP when the deployment could not send the link", () => {
    expect(authErrorCopy("Error sending magic link email", "magic-link")).toMatch(/SMTP/);
  });

  it("handles the rate limiter", () => {
    expect(
      authErrorCopy("For security purposes, you can only request this after 51 seconds", "signin"),
    ).toMatch(/Too many attempts/);
  });

  it("falls back per action and never echoes an unknown raw string", () => {
    const raw = "kaboom-9000";
    for (const action of ["signin", "signup", "magic-link"] as const) {
      const copy = authErrorCopy(raw, action);
      expect(copy).not.toContain(raw);
      expect(copy.length).toBeGreaterThan(10);
    }
    expect(authErrorCopy(raw, "magic-link")).toMatch(/no email configured/);
  });

  it("handles a null/undefined message", () => {
    expect(authErrorCopy(null, "signin")).toMatch(/Couldn’t sign you in/);
    expect(authErrorCopy(undefined, "signup")).toMatch(/Couldn’t create the account/);
  });
});
