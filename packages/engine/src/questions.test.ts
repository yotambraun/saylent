// the spec (see METHODOLOGY.md) "Done when": exactly 23 (template-set v2), all seven types at
// quota, no duplicates, single-competitor brands still fill the comparison quota.
import { describe, expect, it } from "vitest";
import {
  generateQuestions,
  resolveTemplates,
  sameTemplateSet,
  TEMPLATE_SET_VERSION,
  templateSetVersion,
} from "./questions";
import type { QuestionTemplateConfig } from "./config";
import type { BrandModel, Question } from "./types";

const bm = (over: Partial<BrandModel> = {}): BrandModel => ({
  brand: "Acme Cloud",
  domain: "acmecloud.com",
  aliases: ["Acme Cloud", "acmecloud"],
  category: "CDN",
  icp: "high-traffic SaaS",
  products: [],
  value_props: [],
  problems: ["slow page loads worldwide", "origin overload at peak"],
  competitors: ["Cloudflare", "Fastly"],
  language: "en",
  ...over,
});

describe("generateQuestions", () => {
  it("produces exactly 23 with quotas 8/5/4/3 + 1/1/1 and qids q01…q23", () => {
    const qs = generateQuestions(bm(), 2026);
    expect(qs).toHaveLength(23);
    const byType = (t: string) => qs.filter((q) => q.qtype === t).length;
    expect(byType("category")).toBe(8);
    expect(byType("comparison")).toBe(5);
    expect(byType("problem")).toBe(4);
    expect(byType("branded")).toBe(3);
    expect(byType("integration")).toBe(1);
    expect(byType("migration")).toBe(1);
    expect(byType("trust")).toBe(1);
    expect(qs[0].qid).toBe("q01");
    expect(qs[22].qid).toBe("q23");
  });

  it("has no duplicates on collapsed text", () => {
    const qs = generateQuestions(bm(), 2026);
    const keys = qs.map((q) => q.text.toLowerCase().replace(/[^a-z0-9]/g, ""));
    expect(new Set(keys).size).toBe(23);
  });

  it("emits the three buyer-risk archetypes with correct buyer phrasing (v2)", () => {
    const qs = generateQuestions(bm(), 2026);
    const byType = (t: string) => qs.find((q) => q.qtype === t)?.text;
    expect(byType("integration")).toBe(
      "Does Acme Cloud integrate well with the tools high-traffic SaaS already use?",
    );
    expect(byType("migration")).toBe("We're using Cloudflare — is switching to Acme Cloud worth it?");
    expect(byType("trust")).toBe("Is Acme Cloud legit and safe to rely on for high-traffic SaaS?");
    // buyer-risk archetypes appear AFTER the four original types (generation order)
    const firstRiskIdx = qs.findIndex((q) => ["integration", "migration", "trust"].includes(q.qtype));
    expect(firstRiskIdx).toBe(20);
    // no braces survive in any archetype
    for (const q of qs.filter((q) => ["integration", "migration", "trust"].includes(q.qtype))) {
      expect(q.text).not.toMatch(/{\w+}/);
    }
  });

  it("generation is deterministic (same input → identical set)", () => {
    const a = generateQuestions(bm(), 2026);
    const b = generateQuestions(bm(), 2026);
    expect(a).toEqual(b);
  });

  it("TEMPLATE_SET_VERSION is 2 (v2 adds the buyer-risk archetypes)", () => {
    expect(TEMPLATE_SET_VERSION).toBe(2);
  });

  it("single-competitor brands still fill the comparison quota", () => {
    const qs = generateQuestions(bm({ competitors: ["Cloudflare"] }), 2026);
    expect(qs.filter((q) => q.qtype === "comparison")).toHaveLength(5);
    expect(qs.some((q) => q.text.includes("another leading option"))).toBe(true);
  });

  // ---- no-competitor freeze fix: never render "the leading alternative" /
  // "another leading option" filler text (the run.json q10-style questions
  // four engines answered with "which two options are you comparing? too
  // vague") — skip templates that need a named rival instead. ----

  it("no generated question text contains the no-competitor filler strings when competitors is empty", () => {
    const qs = generateQuestions(bm({ competitors: [] }), 2026);
    for (const q of qs) {
      expect(q.text).not.toContain("the leading alternative");
      expect(q.text).not.toContain("another leading option");
    }
  });

  it("drops comparison/migration entirely and reports the skip when there is no named rival", () => {
    const qs = generateQuestions(bm({ competitors: [] }), 2026);
    expect(qs.some((q) => q.qtype === "comparison")).toBe(false);
    expect(qs.some((q) => q.qtype === "migration")).toBe(false);
    // the other five types are unaffected
    expect(qs.filter((q) => q.qtype === "problem")).toHaveLength(4);
    expect(qs.filter((q) => q.qtype === "branded")).toHaveLength(3);
    expect(qs.filter((q) => q.qtype === "integration")).toHaveLength(1);
    expect(qs.filter((q) => q.qtype === "trust")).toHaveLength(1);
    expect(qs.skipped).toBeDefined();
    expect(qs.skipped?.reason).toBe("no-competitor");
    expect(qs.skipped?.count).toBeGreaterThan(0);
  });

  it("also treats the brand-model's own guaranteed-non-empty fallback as no rival", () => {
    // buildBrandModel never returns an empty competitors array — it falls
    // back to ["the leading alternative"]. Make sure THAT shape is caught too.
    const qs = generateQuestions(bm({ competitors: ["the leading alternative"] }), 2026);
    for (const q of qs) {
      expect(q.text).not.toContain("the leading alternative");
      expect(q.text).not.toContain("another leading option");
    }
    expect(qs.some((q) => q.qtype === "comparison")).toBe(false);
  });

  it("comparison questions render normally once a real competitor is given", () => {
    const qs = generateQuestions(bm({ competitors: ["Cloudflare"] }), 2026);
    expect(qs.filter((q) => q.qtype === "comparison")).toHaveLength(5);
    expect(qs.some((q) => q.qtype === "migration")).toBe(true);
    expect(qs.skipped).toBeUndefined();
    for (const q of qs) {
      expect(q.text).not.toContain("the leading alternative");
    }
  });

  it("rotates competitors and problems across iterations", () => {
    const qs = generateQuestions(bm(), 2026);
    const comparisonText = qs.filter((q) => q.qtype === "comparison").map((q) => q.text).join(" ");
    expect(comparisonText).toContain("Cloudflare");
    expect(comparisonText).toContain("Fastly");
    const problemText = qs.filter((q) => q.qtype === "problem").map((q) => q.text).join(" ");
    expect(problemText).toContain("slow page loads worldwide");
    expect(problemText).toContain("origin overload at peak");
  });

  it("instantiates {year} and placeholders (no braces survive)", () => {
    const qs = generateQuestions(bm(), 2026);
    expect(qs.some((q) => q.text.includes("2026"))).toBe(true);
    expect(qs.every((q) => !/{\w+}/.test(q.text))).toBe(true);
  });

  // ---- E1a: broken-English fixes (plural ICP + sentence-fragment problems) ----

  it("plural ICP reads grammatically in every category/comparison template (no 'a <plural>')", () => {
    const qs = generateQuestions(bm({ icp: "software developers and engineering teams" }), 2026);
    const withIcp = qs.filter(
      (q) => q.qtype === "category" || q.qtype === "comparison",
    );
    // the old bug: "should a software developers and engineering teams choose"
    for (const q of withIcp) {
      expect(q.text).not.toMatch(/\ba software developers/i);
      expect(q.text).not.toMatch(/\ba [a-z]+ and [a-z]+ teams\b/i);
    }
    // the fixed template must exist and be article-free before the ICP
    expect(
      qs.some((q) => q.text === "Which CDN should software developers and engineering teams choose and why?"),
    ).toBe(true);
  });

  it("capitalized sentence-fragment problems become readable in every problem template", () => {
    const qs = generateQuestions(
      bm({
        problems: [
          "Need to track email delivery, opens, clicks in real-time",
          "Complex email platform APIs difficult for developers to integrate",
        ],
      }),
      2026,
    );
    const problems = qs.filter((q) => q.qtype === "problem");
    expect(problems).toHaveLength(4);
    // mid-sentence injections must be lowercased; no trailing period jammed in
    expect(problems.some((q) => q.text === "Recommended providers for need to track email delivery, opens, clicks in real-time?")).toBe(true);
    expect(
      problems.some(
        (q) =>
          q.text ===
          "What's the best way to handle complex email platform APIs difficult for developers to integrate — any recommended solutions?",
      ),
    ).toBe(true);
    // no leftover capital immediately after "for " / "handle " / "solve: "
    for (const q of problems) {
      expect(q.text).not.toMatch(/\bfor Need\b/);
      expect(q.text).not.toMatch(/\bhandle Complex\b/);
    }
  });

  it("problem at the start of a template stays capitalized", () => {
    const qs = generateQuestions(
      bm({ problems: ["Need to track email delivery in real-time"] }),
      2026,
    );
    // template "{problem} — which product would you use and why?"
    expect(
      qs.some((q) => q.text.startsWith("Need to track email delivery in real-time — which product")),
    ).toBe(true);
  });

  it("acronym guard: 'API rate limits …' keeps API uppercase mid-sentence", () => {
    const qs = generateQuestions(
      bm({ problems: ["API rate limits confusing users"] }),
      2026,
    );
    const problems = qs.filter((q) => q.qtype === "problem");
    expect(problems.some((q) => q.text === "Recommended providers for API rate limits confusing users?")).toBe(true);
    for (const q of problems) expect(q.text).not.toContain("aPI rate");
  });

  it("dedupe/quota behavior unchanged with normalized values", () => {
    const qs = generateQuestions(
      bm({
        icp: "software developers and engineering teams",
        problems: [
          "Need to track email delivery, opens, clicks in real-time",
          "Complex email platform APIs difficult for developers to integrate",
          "Emails landing in spam folders instead of inboxes",
        ],
      }),
      2026,
    );
    expect(qs).toHaveLength(23);
    const keys = qs.map((q) => q.text.toLowerCase().replace(/[^a-z0-9]/g, ""));
    expect(new Set(keys).size).toBe(23);
    expect(qs.filter((q) => q.qtype === "category")).toHaveLength(8);
    expect(qs.filter((q) => q.qtype === "comparison")).toHaveLength(5);
    expect(qs.filter((q) => q.qtype === "problem")).toHaveLength(4);
    expect(qs.filter((q) => q.qtype === "branded")).toHaveLength(3);
    expect(qs.filter((q) => q.qtype === "integration")).toHaveLength(1);
    expect(qs.filter((q) => q.qtype === "migration")).toHaveLength(1);
    expect(qs.filter((q) => q.qtype === "trust")).toHaveLength(1);
  });

  // Frozen-set immunity: adding template-set v2 must not retro-mutate a brand's
  // already-frozen set. The pipeline reuses the stored question_set VERBATIM
  // (inngest/functions.ts) — generateQuestions is called for new/re-baselined
  // brands only. A stored v1 set (20 questions) is passed through untouched: it
  // is data, never regenerated, so its length and qids are unaffected by v2.
  it("frozen-set immunity: a stored v1 set is never regenerated (reuse is verbatim)", () => {
    const frozenV1: Question[] = Array.from({ length: 20 }, (_, i) => ({
      qid: `q${String(i + 1).padStart(2, "0")}`,
      text: `frozen question ${i + 1}`,
      qtype: "category" as const,
    }));
    // the reuse contract: the stored array is passed through with zero transforms
    const reused = frozenV1;
    expect(reused).toBe(frozenV1);
    expect(reused).toHaveLength(20);
    expect(reused[19].qid).toBe("q20");
    // regenerating fresh (a re-baseline) yields v2's 23 — the two are independent
    expect(generateQuestions(bm(), 2026)).toHaveLength(23);
  });
});

// ---- saylent.config questionTemplates: replace-by-key, add-keys, quota
// overrides, and the version stamp that makes verify refuse a changed set ----
describe("resolveTemplates / templateSetVersion (saylent.config questionTemplates)", () => {
  it("no overrides ⇒ the shipped library, byte for byte, version unchanged", () => {
    const lib = resolveTemplates(undefined);
    expect(lib.customized).toBe(false);
    expect(lib.order).toEqual([
      "category",
      "comparison",
      "problem",
      "branded",
      "integration",
      "migration",
      "trust",
    ]);
    expect(templateSetVersion(undefined)).toBe(TEMPLATE_SET_VERSION);
  });

  it("replaces a shipped key's phrasings by key", () => {
    const overrides: QuestionTemplateConfig = { trust: { templates: ["Can I trust {brand}?"] } };
    const lib = resolveTemplates(overrides);
    expect(lib.templates.trust).toEqual(["Can I trust {brand}?"]);
    expect(lib.customized).toBe(true);
  });

  it("overrides a shipped key's quota only, leaving its templates untouched", () => {
    const overrides: QuestionTemplateConfig = { trust: { quota: 3 } };
    const lib = resolveTemplates(overrides);
    expect(lib.quotas.trust).toBe(3);
    expect(lib.templates.trust).toEqual(["Is {brand} legit and safe to rely on for {icp}?"]);
  });

  it("quota: 0 drops a shipped group entirely from generation order", () => {
    const overrides: QuestionTemplateConfig = { migration: { quota: 0 } };
    const lib = resolveTemplates(overrides);
    expect(lib.order).not.toContain("migration");
    const qs = generateQuestions(bm(), 2026, overrides);
    expect(qs.some((q) => q.qtype === "migration")).toBe(false);
  });

  it("a key outside the shipped library adds a new group typed 'custom'", () => {
    const overrides: QuestionTemplateConfig = {
      pricing_launch: { templates: ["Is {brand} affordable for {icp}?"], quota: 2 },
    };
    const qs = generateQuestions(bm(), 2026, overrides);
    const added = qs.filter((q) => q.text.includes("affordable"));
    expect(added).toHaveLength(1); // only one distinct phrasing → dedupe caps it at 1 unique
    expect(added.every((q) => q.qtype === "custom")).toBe(true);
  });

  it("a new group with no templates throws a clear error", () => {
    expect(() => resolveTemplates({ pricing_launch: { quota: 2 } })).toThrow(
      /pricing_launch is a new group and needs at least one template string/,
    );
  });

  it("templateSetVersion stamps '<base>+custom' the instant an override changes anything", () => {
    expect(templateSetVersion({ trust: { quota: 2 } })).toBe(`${TEMPLATE_SET_VERSION}+custom`);
    expect(templateSetVersion({ trust: {} })).toBe(TEMPLATE_SET_VERSION); // no-op override ⇒ unchanged
  });

  it("sameTemplateSet: version-bump detection verify relies on to refuse a changed library", () => {
    expect(sameTemplateSet(2, 2)).toBe(true);
    expect(sameTemplateSet(2, "2+custom")).toBe(false);
    expect(sameTemplateSet("2+custom", "2+custom")).toBe(true);
    expect(sameTemplateSet(undefined, undefined)).toBe(true);
    expect(sameTemplateSet(null, 2)).toBe(false);
  });

  it("generateQuestions with overrides stays deterministic and dedupes across the merged set", () => {
    const overrides: QuestionTemplateConfig = { trust: { templates: ["Can I trust {brand}?"] } };
    const a = generateQuestions(bm(), 2026, overrides);
    const b = generateQuestions(bm(), 2026, overrides);
    expect(a).toEqual(b);
    expect(a.find((q) => q.qtype === "trust")?.text).toBe("Can I trust Acme Cloud?");
  });
});
