// SEC-HARDEN favicon self-proxy — the domain guard is pure; pin what it accepts/rejects.
import { describe, expect, it } from "vitest";
import { isUnresolvableHost, isValidDomain } from "./route";

describe("isValidDomain", () => {
  it("accepts plain hostnames", () => {
    for (const d of ["example.com", "sub.example.co.uk", "a.io", "my-brand.dev", "x1.y2.z3"]) {
      expect(isValidDomain(d)).toBe(true);
    }
  });

  it("rejects empty / nullish input", () => {
    expect(isValidDomain(null)).toBe(false);
    expect(isValidDomain(undefined)).toBe(false);
    expect(isValidDomain("")).toBe(false);
  });

  it("rejects schemes, paths, ports, query strings and userinfo", () => {
    for (const d of [
      "https://example.com",
      "example.com/path",
      "example.com:8080",
      "example.com?x=1",
      "user@example.com",
      "//example.com",
      "http://example.com/s2/favicons?domain=evil",
    ]) {
      expect(isValidDomain(d)).toBe(false);
    }
  });

  it("rejects single labels, spaces, and leading/trailing hyphens", () => {
    for (const d of ["localhost", "example .com", "-example.com", "example-.com", "exam ple.com"]) {
      expect(isValidDomain(d)).toBe(false);
    }
  });

  it("rejects over-length hostnames (>253 chars)", () => {
    const long = `${"a".repeat(250)}.com`;
    expect(isValidDomain(long)).toBe(false);
  });
});

describe("isUnresolvableHost", () => {
  it("short-circuits the reserved TLDs the sample report is full of", () => {
    for (const d of ["acmecloud.example", "nimbus.EXAMPLE", "a.b.invalid", "foo.test"]) {
      expect(isUnresolvableHost(d)).toBe(true);
    }
  });

  it("leaves real hosts alone", () => {
    for (const d of ["example.com", "sub.example.co.uk", "my-brand.dev"]) {
      expect(isUnresolvableHost(d)).toBe(false);
    }
  });
});
