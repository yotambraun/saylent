// The pure blocked-domain matcher. The DB read
// (blocked_domains via the service role) is integration-verified; here we pin the
// match semantics both createBrand and createRun rely on.
import { describe, expect, it } from "vitest";
import { matchBlockedDomain, normalizeHost } from "./blocked-domains";

describe("normalizeHost", () => {
  it("strips protocol, path, www and lowercases", () => {
    expect(normalizeHost("https://www.Acme.com/pricing")).toBe("acme.com");
    expect(normalizeHost("HTTP://Shop.ACME.com")).toBe("shop.acme.com");
    expect(normalizeHost("  acme.com  ")).toBe("acme.com");
  });
});

describe("matchBlockedDomain", () => {
  const list = ["acme.com", "spam.io"];

  it("matches an exact domain", () => {
    expect(matchBlockedDomain("acme.com", list)).toBe("acme.com");
  });

  it("matches a subdomain of a blocked domain", () => {
    expect(matchBlockedDomain("shop.acme.com", list)).toBe("acme.com");
    expect(matchBlockedDomain("a.b.spam.io", list)).toBe("spam.io");
  });

  it("does NOT match an unrelated domain", () => {
    expect(matchBlockedDomain("notacme.com", list)).toBeNull();
  });

  it("does NOT match a lookalike suffix-spoof (acme.com.evil.net)", () => {
    // ends with ".evil.net", not ".acme.com" — must not be blocked by "acme.com".
    expect(matchBlockedDomain("acme.com.evil.net", list)).toBeNull();
  });

  it("treats a false superstring correctly (fakeacme.com is not blocked)", () => {
    expect(matchBlockedDomain("fakeacme.com", ["acme.com"])).toBeNull();
  });

  it("normalizes both sides before comparing", () => {
    expect(matchBlockedDomain("https://www.Acme.com/x", ["  ACME.com "])).toBe("acme.com");
  });

  it("returns null for an empty domain or empty list", () => {
    expect(matchBlockedDomain("", list)).toBeNull();
    expect(matchBlockedDomain("acme.com", [])).toBeNull();
  });
});
