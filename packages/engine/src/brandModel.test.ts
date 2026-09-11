// the spec (see METHODOLOGY.md) — buildBrandModel deterministic post-processing (E1a): problems
// are trimmed, trailing punctuation is stripped, and the first letter is
// lowercased (acronym-safe) so the frozen question set reads as clean English.
import { describe, expect, it } from "vitest";
import { brandModelConfidence, buildBrandModel, type LlmCall } from "./brandModel";
import type { BrandModel, SitePage } from "./types";

const pages: SitePage[] = [
  { url: "https://x.com", status: 200, title: "X", text: "text", ldTypes: [], metaRobots: "", links: [] },
];

/** A realistic multi-page crawl with plenty of readable text (rich site). */
const richPages: SitePage[] = [1, 2, 3].map((i) => ({
  url: `https://acme.com/${i}`,
  status: 200,
  title: `Acme ${i}`,
  text: "Acme Cloud is a global CDN that accelerates page loads and absorbs origin overload. ".repeat(6),
  ldTypes: [],
  metaRobots: "",
  links: [],
}));

/** A well-modeled brand (concrete products + value props, no fallback fields). */
const richModel = (over: Partial<BrandModel> = {}): BrandModel => ({
  brand: "Acme Cloud",
  domain: "acme.com",
  aliases: ["Acme Cloud"],
  category: "CDN",
  icp: "high-traffic SaaS teams",
  products: ["Edge CDN", "DDoS shield"],
  value_props: ["fast global delivery", "origin protection"],
  problems: ["slow page loads worldwide"],
  competitors: ["Cloudflare", "Fastly"],
  language: "en",
  ...over,
});

/** returns a callLlm that always yields the given JSON string */
const llmReturning = (obj: unknown): LlmCall => async () => JSON.stringify(obj);

const input = { brand: "X", domain: "x.com" };

describe("buildBrandModel problem post-processing", () => {
  it("lowercases capitalized sentence-fragment problems and strips trailing periods", async () => {
    const bm = await buildBrandModel(
      input,
      pages,
      llmReturning({
        problems: [
          "Need to track email delivery, opens, clicks in real-time.",
          "Complex email platform APIs difficult for developers to integrate",
          "Emails landing in spam folders instead of inboxes.",
        ],
      }),
    );
    expect(bm.problems).toEqual([
      "need to track email delivery, opens, clicks in real-time",
      "complex email platform APIs difficult for developers to integrate",
      "emails landing in spam folders instead of inboxes",
    ]);
  });

  it("acronym guard: leaves an opening acronym uppercase", async () => {
    const bm = await buildBrandModel(
      input,
      pages,
      llmReturning({ problems: ["API rate limits confusing users", "CRM data silos"] }),
    );
    expect(bm.problems).toEqual(["API rate limits confusing users", "CRM data silos"]);
  });

  it("collapses internal whitespace and drops empties", async () => {
    const bm = await buildBrandModel(
      input,
      pages,
      llmReturning({ problems: ["  Slow   page   loads  ", "   ", "..."] }),
    );
    expect(bm.problems).toEqual(["slow page loads"]);
  });

  it("keeps the non-empty fallback when the model returns no usable problems", async () => {
    const bm = await buildBrandModel(
      { brand: "X", domain: "x.com", category: "CDN" },
      pages,
      llmReturning({ problems: [] }),
    );
    expect(bm.problems).toEqual(["choosing the right CDN"]);
  });
});

// Low-confidence signal (heuristic + model self-report, combined).
describe("brandModelConfidence heuristic", () => {
  it("rich crawl + well-modeled brand → ok", () => {
    expect(brandModelConfidence(richPages, richModel())).toBe("ok");
  });

  it("thin text (< 600 chars total) → low", () => {
    expect(brandModelConfidence(pages, richModel())).toBe("low");
  });

  it("no concrete products AND value_props → low even on a rich crawl", () => {
    expect(brandModelConfidence(richPages, richModel({ products: [], value_props: [] }))).toBe("low");
  });

  it("two+ identity fields fell back to generic sentinels → low", () => {
    const bm = richModel({
      category: "product",
      icp: "teams evaluating options",
    });
    expect(brandModelConfidence(richPages, bm)).toBe("low");
  });

  it("a single fallback field alone does not trip low", () => {
    expect(brandModelConfidence(richPages, richModel({ competitors: ["the leading alternative"] }))).toBe("ok");
  });

  it("fewer than two readable pages → low", () => {
    expect(brandModelConfidence(richPages.slice(0, 1), richModel())).toBe("low");
  });
});

describe("buildBrandModel confidence (combined signal)", () => {
  it("thin fallback model → low (heuristic fires)", async () => {
    const bm = await buildBrandModel(input, pages, llmReturning({}));
    expect(bm.confidence).toBe("low");
  });

  it("rich model on a rich crawl → ok", async () => {
    const bm = await buildBrandModel(
      { brand: "Acme Cloud", domain: "acme.com" },
      richPages,
      llmReturning({
        category: "CDN",
        icp: "high-traffic SaaS teams",
        products: ["Edge CDN", "DDoS shield"],
        value_props: ["fast global delivery", "origin protection"],
        problems: ["slow page loads worldwide"],
        competitors: ["Cloudflare", "Fastly"],
        language: "en",
        confidence: "ok",
      }),
    );
    expect(bm.confidence).toBe("ok");
  });

  it("model self-reports low → low even when the heuristic would say ok", async () => {
    const bm = await buildBrandModel(
      { brand: "Acme Cloud", domain: "acme.com" },
      richPages,
      llmReturning({
        category: "CDN",
        icp: "high-traffic SaaS teams",
        products: ["Edge CDN", "DDoS shield"],
        value_props: ["fast global delivery", "origin protection"],
        problems: ["slow page loads worldwide"],
        competitors: ["Cloudflare", "Fastly"],
        language: "en",
        confidence: "low",
      }),
    );
    expect(bm.confidence).toBe("low");
  });
});
