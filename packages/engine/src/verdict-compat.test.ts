// E2a — verdict-compat normalizers must handle BOTH DB shapes forever
// (old `string[]`, new `{text,kind}[]` / `{name,why}[]`) plus arbitrary junk.
import { describe, expect, it } from "vitest";
import { CLAIM_KINDS, normClaims, normOtherBrands } from "./verdict-compat";

describe("normClaims", () => {
  it("coerces OLD-shape strings to kind neutral_fact and trims", () => {
    expect(normClaims({ claims: ["  Fast CDN ", "Free tier"] })).toEqual([
      { text: "Fast CDN", kind: "neutral_fact" },
      { text: "Free tier", kind: "neutral_fact" },
    ]);
  });

  it("keeps NEW-shape claims and validates kind", () => {
    expect(
      normClaims({
        claims: [
          { text: "Praised for speed", kind: "praise" },
          { text: "Reviews cite outages", kind: "risk" },
          { text: "$10/mo", kind: "neutral_fact" },
        ],
      }),
    ).toEqual([
      { text: "Praised for speed", kind: "praise" },
      { text: "Reviews cite outages", kind: "risk" },
      { text: "$10/mo", kind: "neutral_fact" },
    ]);
  });

  it("invalid/absent kind falls back to neutral_fact", () => {
    expect(normClaims({ claims: [{ text: "x", kind: "banana" }, { text: "y" }] })).toEqual([
      { text: "x", kind: "neutral_fact" },
      { text: "y", kind: "neutral_fact" },
    ]);
  });

  it("drops empty text, junk entries, and handles non-array / missing", () => {
    expect(normClaims({ claims: ["", "  ", { text: "" }, { kind: "risk" }, 5, null] })).toEqual([]);
    expect(normClaims({ claims: "not-an-array" })).toEqual([]);
    expect(normClaims({})).toEqual([]);
    expect(normClaims(null)).toEqual([]);
    expect(normClaims(undefined)).toEqual([]);
  });

  it("CLAIM_KINDS is the three allowed kinds", () => {
    expect([...CLAIM_KINDS]).toEqual(["praise", "risk", "neutral_fact"]);
  });
});

describe("normOtherBrands", () => {
  it("coerces OLD-shape strings to why '' and trims names", () => {
    expect(normOtherBrands({ other_brands: [" Rival ", "Other"] })).toEqual([
      { name: "Rival", why: "" },
      { name: "Other", why: "" },
    ]);
  });

  it("keeps NEW-shape {name,why}; coerces non-string why to ''", () => {
    expect(
      normOtherBrands({
        other_brands: [
          { name: "Rival", why: "cheaper enterprise pricing" },
          { name: "Other", why: 42 },
        ],
      }),
    ).toEqual([
      { name: "Rival", why: "cheaper enterprise pricing" },
      { name: "Other", why: "" },
    ]);
  });

  it("drops empty names, junk entries, and handles non-array / missing", () => {
    expect(
      normOtherBrands({ other_brands: ["", "  ", { name: "" }, { why: "x" }, 9, null] }),
    ).toEqual([]);
    expect(normOtherBrands({ other_brands: {} })).toEqual([]);
    expect(normOtherBrands({})).toEqual([]);
    expect(normOtherBrands(null)).toEqual([]);
  });
});
