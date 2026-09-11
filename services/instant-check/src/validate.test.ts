import { describe, expect, it } from "vitest";
import { MAX_DOMAIN_LENGTH, validateDomain } from "./validate";

describe("validateDomain", () => {
  it("accepts a bare domain, a www host and a full https URL, always returning the bare host", () => {
    for (const input of ["acme.com", "  acme.com  ", "ACME.com", "https://acme.com", "https://acme.com/", "http://acme.com"]) {
      expect(validateDomain(input)).toEqual({ ok: true, domain: "acme.com" });
    }
    expect(validateDomain("www.acme.com")).toEqual({ ok: true, domain: "www.acme.com" });
  });

  it("normalises an internationalised domain to punycode", () => {
    expect(validateDomain("bücher.de")).toEqual({ ok: true, domain: "xn--bcher-kva.de" });
  });

  it("reports a missing domain separately from an invalid one", () => {
    for (const empty of [null, undefined, "", "   "]) {
      expect(validateDomain(empty)).toMatchObject({ ok: false, code: "missing_domain" });
    }
    expect(validateDomain("nope")).toMatchObject({ ok: false, code: "invalid_domain" });
  });

  it("rejects anything longer than 253 characters before parsing it", () => {
    const long = `${"a".repeat(MAX_DOMAIN_LENGTH)}.com`;
    expect(validateDomain(long)).toMatchObject({ ok: false, code: "invalid_domain" });
  });

  it("rejects private, loopback and internal hosts", () => {
    for (const host of [
      "localhost",
      "LOCALHOST",
      "printer.local",
      "db.internal",
      "box.lan",
      "thing.home.arpa",
      "site.test",
      "hidden.onion",
    ]) {
      expect(validateDomain(host), host).toMatchObject({ ok: false, code: "invalid_domain" });
    }
  });

  it("rejects IP literals, including the decimal and hex evasions", () => {
    for (const host of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "2130706433", "0x7f.1", "[::1]", "http://[::1]/"]) {
      expect(validateDomain(host), host).toMatchObject({ ok: false, code: "invalid_domain" });
    }
  });

  it("rejects credentials, ports, paths, queries and non-http schemes", () => {
    for (const input of [
      "user:pass@acme.com",
      "acme.com:8080",
      "acme.com/admin",
      "https://acme.com/robots.txt",
      "acme.com?x=1",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "gopher://acme.com",
      "acme .com",
    ]) {
      expect(validateDomain(input), input).toMatchObject({ ok: false, code: "invalid_domain" });
    }
  });

  it("rejects malformed labels", () => {
    for (const host of ["-acme.com", "acme-.com", "acme..com", "acme.c", "acme.1com", `${"a".repeat(64)}.com`]) {
      expect(validateDomain(host), host).toMatchObject({ ok: false, code: "invalid_domain" });
    }
  });
});
