import { describe, expect, it } from "vitest";
import { parseAuthMethods, signInRecoveryCopy } from "./auth-methods";

describe("parseAuthMethods", () => {
  it("defaults to password + magic link", () => {
    expect(parseAuthMethods(undefined)).toEqual(["password", "magic-link"]);
    expect(parseAuthMethods("")).toEqual(["password", "magic-link"]);
    expect(parseAuthMethods("nonsense")).toEqual(["password", "magic-link"]);
  });

  it("parses, trims and drops unknown entries", () => {
    expect(parseAuthMethods(" password , google ,nope")).toEqual(["password", "google"]);
  });
});

describe("signInRecoveryCopy", () => {
  it("says password (and offers reset) on the shipped default", () => {
    const { sentence, showReset } = signInRecoveryCopy(["password", "magic-link"]);
    expect(sentence).toMatch(/password/i);
    expect(sentence).not.toMatch(/There is no password to lose/);
    expect(showReset).toBe(true);
  });

  it("says magic link, and offers no reset, when passwords are off", () => {
    const { sentence, showReset } = signInRecoveryCopy(["magic-link"]);
    expect(sentence).toMatch(/link emailed to you/);
    expect(showReset).toBe(false);
  });

  it("covers google-only", () => {
    expect(signInRecoveryCopy(["google"]).sentence).toMatch(/Google/);
  });

  it("fails honestly when nothing is configured", () => {
    expect(signInRecoveryCopy([]).sentence).toMatch(/no sign-in method/i);
  });
});
