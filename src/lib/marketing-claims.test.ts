// Guards the claims bank contract: every marketing stat we show a buyer must be
// sourced (https URL) and dated, ids must be unique, and claim() must resolve.
// The project rule is that no public-page number is unattributed — this test is
// what makes that structurally impossible to forget.
import { describe, expect, it } from "vitest";
import { MARKETING_CLAIMS, claim } from "./marketing-claims";

describe("MARKETING_CLAIMS", () => {
  it("has claims", () => {
    expect(MARKETING_CLAIMS.length).toBeGreaterThan(0);
  });

  it("every claim carries a source URL and a date", () => {
    for (const c of MARKETING_CLAIMS) {
      expect(c.sourceUrl, `${c.id} sourceUrl`).toMatch(/^https:\/\/.+/);
      expect(c.datedAt.trim(), `${c.id} datedAt`).not.toBe("");
      expect(c.sourceName.trim(), `${c.id} sourceName`).not.toBe("");
    }
  });

  it("every claim has non-empty claim text and a stat range", () => {
    for (const c of MARKETING_CLAIMS) {
      expect(c.claim.trim(), `${c.id} claim`).not.toBe("");
      expect(c.statRange.trim(), `${c.id} statRange`).not.toBe("");
    }
  });

  it("ids are unique", () => {
    const ids = MARKETING_CLAIMS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries the six sourced stats the marketing pages rely on", () => {
    const ids = new Set(MARKETING_CLAIMS.map((c) => c.id));
    for (const id of [
      "cdn-silent-block",
      "cloudflare-defaults",
      "ai-referral-conversion",
      "citation-concentration",
      "wikipedia-reddit-share",
      "chatgpt-ads",
    ]) {
      expect(ids.has(id), `missing claim: ${id}`).toBe(true);
    }
  });

  it("claim() resolves a known id and throws on an unknown one", () => {
    expect(claim("cdn-silent-block").id).toBe("cdn-silent-block");
    expect(() => claim("nope")).toThrow(/Unknown marketing claim/);
  });
});
