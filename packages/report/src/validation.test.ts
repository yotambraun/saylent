// zod bounds on brand + profile inputs.
import { describe, expect, it } from "vitest";
import {
  MAX_COMPETITORS,
  displayNameSchema,
  isValidTimeZone,
  parseCompetitors,
  splitSiteRoot,
  validateBrandFields,
  validateSiteRoot,
} from "./validation";

describe("validateBrandFields", () => {
  const ok = { name: "Acme", domain: "https://acme.com", category: "CRM", competitorsCsv: "a.com, b.com" };

  it("accepts and normalizes a valid brand", () => {
    const r = validateBrandFields(ok);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe("Acme");
      expect(r.value.domain).toBe("acme.com"); // protocol stripped, host lowercased
      expect(r.value.category).toBe("CRM");
      expect(r.value.competitors).toEqual(["a.com", "b.com"]);
    }
  });

  it("rejects an empty name", () => {
    expect(validateBrandFields({ ...ok, name: "  " }).ok).toBe(false);
  });

  it("rejects an over-long name (>120)", () => {
    expect(validateBrandFields({ ...ok, name: "x".repeat(121) }).ok).toBe(false);
  });

  it("rejects a malformed domain", () => {
    expect(validateBrandFields({ ...ok, domain: "not a domain" }).ok).toBe(false);
    expect(validateBrandFields({ ...ok, domain: "localhost" }).ok).toBe(false);
  });

  it("rejects an over-long domain (>253)", () => {
    expect(validateBrandFields({ ...ok, domain: `${"a".repeat(260)}.com` }).ok).toBe(false);
  });

  it("rejects an over-long category (>120)", () => {
    expect(validateBrandFields({ ...ok, category: "y".repeat(121) }).ok).toBe(false);
  });

  // SUBPATH HOSTING: a path is a site root now, not noise.
  it("keeps a subpath site root", () => {
    const r = validateBrandFields({ ...ok, domain: "https://acme.com/docs/" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.domain).toBe("acme.com/docs");
  });

  it("treats missing optional fields as empty", () => {
    const r = validateBrandFields({ name: "Acme", domain: "acme.com" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.category).toBe("");
      expect(r.value.competitors).toEqual([]);
    }
  });
});

describe("parseCompetitors", () => {
  it("caps the count", () => {
    const csv = Array.from({ length: MAX_COMPETITORS + 1 }, (_, i) => `c${i}.com`).join(",");
    expect(parseCompetitors(csv).ok).toBe(false);
  });

  it("caps the raw length (>500)", () => {
    expect(parseCompetitors("x".repeat(501)).ok).toBe(false);
  });

  it("trims and drops blanks", () => {
    const r = parseCompetitors(" a.com , , b.com ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.list).toEqual(["a.com", "b.com"]);
  });
});

describe("displayNameSchema", () => {
  it("accepts up to 80 chars and trims", () => {
    expect(displayNameSchema.safeParse("  Jane  ").success).toBe(true);
    expect(displayNameSchema.safeParse("z".repeat(80)).success).toBe(true);
  });

  it("rejects over 80 chars", () => {
    expect(displayNameSchema.safeParse("z".repeat(81)).success).toBe(false);
  });
});

describe("isValidTimeZone", () => {
  it("accepts real IANA zones", () => {
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    expect(isValidTimeZone("  Asia/Tokyo  ")).toBe(true);
  });

  it("rejects junk, unknown zones and empty input", () => {
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("not a zone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("   ")).toBe(false);
  });
});

// SUBPATH HOSTING (see the finding in
// examples/brand-site/PLANTED-GAPS.md): a brand site may live under a path. The
// engine audits those already (parseSiteRoot in packages/engine/src/crawl.ts), so
// the brand form must keep the path instead of throwing it away. Bare-domain
// results must be unchanged — the first block pins that.
describe("splitSiteRoot", () => {
  it("returns a bare host unchanged, with no path", () => {
    expect(splitSiteRoot("acme.com")).toEqual({ host: "acme.com", path: "" });
    expect(splitSiteRoot("  HTTPS://Acme.com/  ")).toEqual({ host: "acme.com", path: "" });
  });

  it("lowercases the host only — paths are case-sensitive", () => {
    expect(splitSiteRoot("https://Acme.com/Docs/Guide")).toEqual({
      host: "acme.com",
      path: "/Docs/Guide",
    });
  });

  it("drops the query, the fragment and a trailing slash", () => {
    expect(splitSiteRoot("acme.com/docs/?utm=1#top")).toEqual({ host: "acme.com", path: "/docs" });
  });
});

describe("validateSiteRoot", () => {
  it("accepts a bare domain (unchanged behaviour)", () => {
    const r = validateSiteRoot("acme.com");
    expect(r).toEqual({ ok: true, value: "acme.com" });
  });

  it("accepts https://host/path/ and normalizes it", () => {
    expect(validateSiteRoot("https://yotambraun.github.io/saylent/")).toEqual({
      ok: true,
      value: "yotambraun.github.io/saylent",
    });
  });

  it("rejects a bad host with the domain message, path or not", () => {
    expect(validateSiteRoot("localhost/docs").ok).toBe(false);
    expect(validateSiteRoot("not a domain").ok).toBe(false);
  });

  it("rejects dot segments and spaces in the path", () => {
    expect(validateSiteRoot("acme.com/../etc").ok).toBe(false);
    expect(validateSiteRoot("acme.com/a b").ok).toBe(false);
  });

  it("caps the path length", () => {
    expect(validateSiteRoot(`acme.com/${"x".repeat(130)}`).ok).toBe(false);
  });
});
