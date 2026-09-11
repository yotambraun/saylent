// Colocated unit test for the "Confirm your audit" preview shim (preview.ts).
// Proves the client-side preview matches the pipeline's deterministic generator
// and applies the pipeline's blank-field fallbacks, so what the buyer confirms is
// what the audit freezes.
import { describe, expect, it } from "vitest";
import { buildPreviewModel, buildPreviewQuestions, type PreviewFields } from "./preview";

const YEAR = 2026;
const full: PreviewFields = {
  brand: "Acme Cloud",
  category: "contact data platform",
  icp: "B2B sales teams",
  competitors: ["ZoomInfo", "Apollo", "Cognism"],
  problems: ["finding verified emails"],
};

describe("buildPreviewModel", () => {
  it("maps set fields verbatim and trims competitors/problems", () => {
    const m = buildPreviewModel({ ...full, competitors: [" ZoomInfo ", "", "Apollo"] });
    expect(m.brand).toBe("Acme Cloud");
    expect(m.category).toBe("contact data platform");
    expect(m.icp).toBe("B2B sales teams");
    expect(m.competitors).toEqual(["ZoomInfo", "Apollo"]);
    expect(m.aliases).toEqual(["Acme Cloud"]);
  });

  it("falls back to the pipeline's generic category/icp when blank", () => {
    const m = buildPreviewModel({ brand: "Acme", category: "  ", icp: "", competitors: [] });
    expect(m.category).toBe("product"); // buildBrandModel fallback
    expect(m.icp).toBe("teams evaluating options"); // buildBrandModel fallback
  });
});

describe("buildPreviewQuestions", () => {
  it("produces the 23-question template-set v2 in q01…q23 order", () => {
    const qs = buildPreviewQuestions(full, YEAR);
    expect(qs).toHaveLength(23);
    expect(qs.map((q) => q.qid)).toEqual(
      Array.from({ length: 23 }, (_, i) => `q${String(i + 1).padStart(2, "0")}`),
    );
    // all seven buyer-facing archetypes are represented (v2 quotas 8/5/4/3 + 1/1/1)
    const types = new Set(qs.map((q) => q.qtype));
    expect(types).toEqual(
      new Set(["category", "comparison", "problem", "branded", "integration", "migration", "trust"]),
    );
  });

  it("is deterministic — same fields + year give identical text", () => {
    expect(buildPreviewQuestions(full, YEAR)).toEqual(buildPreviewQuestions(full, YEAR));
  });

  it("re-renders competitor-bearing questions when competitors change (live preview)", () => {
    const withZoom = buildPreviewQuestions(full, YEAR);
    const withRival = buildPreviewQuestions({ ...full, competitors: ["Clearbit"] }, YEAR);
    expect(withZoom.some((q) => q.text.includes("ZoomInfo"))).toBe(true);
    expect(withRival.some((q) => q.text.includes("Clearbit"))).toBe(true);
    expect(withRival.some((q) => q.text.includes("ZoomInfo"))).toBe(false);
  });

  it("shows the brand and category the buyer typed in the questions", () => {
    const qs = buildPreviewQuestions(full, YEAR);
    expect(qs.some((q) => q.text.includes("Acme Cloud"))).toBe(true);
    expect(qs.some((q) => q.text.includes("contact data platform"))).toBe(true);
  });

  it("uses the pipeline's empty-field fallbacks when icp/problems are blank, and skips comparison/migration with no rival", () => {
    const qs = buildPreviewQuestions(
      { brand: "Acme", category: "widgets", icp: "", competitors: [], problems: [] },
      YEAR,
    );
    // generateQuestions' own fallbacks (mirrors the pipeline when the crawl finds nothing)
    expect(qs.some((q) => q.text.includes("teams evaluating options"))).toBe(true);
    expect(qs.some((q) => q.text.includes("choosing the right widgets"))).toBe(true);
    // no competitor named ⇒ never render "the leading alternative" / "another
    // leading option" filler (the run.json q10-style question four engines
    // answered with "which two options are you comparing? too vague")
    expect(qs.some((q) => q.text.includes("the leading alternative"))).toBe(false);
    expect(qs.some((q) => q.text.includes("another leading option"))).toBe(false);
    expect(qs.some((q) => q.qtype === "comparison")).toBe(false);
    expect(qs.some((q) => q.qtype === "migration")).toBe(false);
    expect(qs.skipped?.reason).toBe("no-competitor");
    expect(qs.skipped?.count).toBeGreaterThan(0);
  });
});
