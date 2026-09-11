import { describe, expect, it } from "vitest";
import {
  containsPlaceholder,
  placeholderRefusal,
  PLACEHOLDER_CATEGORY,
  PLACEHOLDER_ICP,
} from "./placeholder-guard";

describe("placeholderRefusal", () => {
  it("passes a brand with a real category and a real buyer", () => {
    expect(placeholderRefusal({ category: "uptime monitoring", icp: "SRE teams" })).toBeNull();
  });

  it("refuses a blank category", () => {
    const r = placeholderRefusal({ category: "", icp: "SRE teams" });
    expect(r).toMatch(/category/i);
  });

  it("refuses the literal category stand-in", () => {
    expect(placeholderRefusal({ category: PLACEHOLDER_CATEGORY, icp: "SRE teams" })).toMatch(
      /category/i,
    );
  });

  it("refuses a blank buyer", () => {
    expect(placeholderRefusal({ category: "uptime monitoring", icp: null })).toMatch(/buys/i);
  });

  it("refuses the literal buyer stand-in", () => {
    expect(placeholderRefusal({ category: "uptime monitoring", icp: PLACEHOLDER_ICP })).toMatch(
      /buys/i,
    );
  });

  it("judges an already-decided question set on its text, not the fields", () => {
    expect(
      placeholderRefusal({
        category: "",
        icp: "",
        questionTexts: ["What is the best uptime monitoring for SRE teams?"],
      }),
    ).toBeNull();
    expect(
      placeholderRefusal({
        category: "uptime monitoring",
        icp: "SRE teams",
        questionTexts: ["What is the best product for teams evaluating options?"],
      }),
    ).toMatch(/stand-in/i);
  });

  it("never trips on the word 'product' inside a real category", () => {
    expect(placeholderRefusal({ category: "product analytics", icp: "PM teams" })).toBeNull();
    expect(
      placeholderRefusal({
        category: "product analytics",
        icp: "PM teams",
        questionTexts: ["Top product analytics options in 2026 — which do you recommend?"],
      }),
    ).toBeNull();
  });
});

describe("containsPlaceholder", () => {
  it("detects the buyer stand-in in a question", () => {
    expect(containsPlaceholder("Which CDN should teams evaluating options choose?")).toBe(true);
    expect(containsPlaceholder("Which CDN should SRE teams choose?")).toBe(false);
  });
});
