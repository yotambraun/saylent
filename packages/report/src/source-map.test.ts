// E3c — Source Map aggregation. Fixtures mirror the real Mailforge run
// (3b2400db): chatgpt cites vendor/own domains, claude cites listicles,
// perplexity cites reddit/community.
import { describe, expect, it } from "vitest";
import { buildSourceMap, hostOf, type SourceMapPage } from "./source-map";

const page = (o: Partial<SourceMapPage> & Pick<SourceMapPage, "page_type" | "cited_by" | "url">): SourceMapPage => ({
  final_url: o.url,
  ...o,
});

// A corpus shaped like the Mailforge run's divergence.
const corpus: SourceMapPage[] = [
  page({ url: "https://mailforge.example/docs", page_type: "brand_owned", cited_by: { chatgpt: 6 } }),
  page({ url: "https://postmarkapp.com/why", page_type: "docs", cited_by: { chatgpt: 4 } }),
  page({ url: "https://twilio.com/sendgrid", page_type: "docs", cited_by: { chatgpt: 3 } }),
  page({ url: "https://mailtrap.io/blog/best-email-api", page_type: "listicle", cited_by: { claude: 5 } }),
  page({ url: "https://emailvendorselection.com/top-email-apis", page_type: "listicle", cited_by: { claude: 4 } }),
  page({ url: "https://www.reddit.com/r/webdev/comments/x", page_type: "forum", cited_by: { perplexity: 5 } }),
  page({ url: "https://news.ycombinator.com/item?id=1", page_type: "forum", cited_by: { perplexity: 2 } }),
  // a page cited by two engines — must be attributed to each separately
  page({ url: "https://g2.com/mailforge", page_type: "review_platform", cited_by: { chatgpt: 1, claude: 1 } }),
];

const rates = { chatgpt: 0.75, claude: 0.5, gemini: null, perplexity: 0 };

describe("hostOf", () => {
  it("strips www and returns bare host; falls back on junk", () => {
    expect(hostOf("https://www.reddit.com/r/x")).toBe("reddit.com");
    expect(hostOf("https://g2.com/mailforge")).toBe("g2.com");
    expect(hostOf(null)).toBe("");
    expect(hostOf("not a url")).toBe("not a url");
  });
  it("unwraps Wayback snapshots to the original host (never web.archive.org)", () => {
    expect(hostOf("https://web.archive.org/web/20240101000000id_/https://www.reddit.com/r/x")).toBe("reddit.com");
  });
});

describe("buildSourceMap", () => {
  const map = buildSourceMap(corpus, rates);

  it("only includes engines that actually cited pages, in canonical order", () => {
    expect(map.engines.map((e) => e.engine)).toEqual(["chatgpt", "claude", "perplexity"]);
  });

  it("sums cited_by per engine grouped by page_type into a dominant type", () => {
    const chatgpt = map.engines.find((e) => e.engine === "chatgpt")!;
    // docs 4+3=7 beats brand_owned 6 and review_platform 1
    expect(chatgpt.dominantType).toBe("docs");
    expect(chatgpt.citations).toBe(6 + 4 + 3 + 1);
    const claude = map.engines.find((e) => e.engine === "claude")!;
    expect(claude.dominantType).toBe("listicle");
    const perplexity = map.engines.find((e) => e.engine === "perplexity")!;
    expect(perplexity.dominantType).toBe("forum");
  });

  it("collects the top 3 cited hosts per engine, count desc", () => {
    const chatgpt = map.engines.find((e) => e.engine === "chatgpt")!;
    expect(chatgpt.topHosts.map((h) => h.host)).toEqual(["mailforge.example", "postmarkapp.com", "twilio.com"]);
    expect(chatgpt.topHosts[0].count).toBe(6);
    const perplexity = map.engines.find((e) => e.engine === "perplexity")!;
    expect(perplexity.topHosts.map((h) => h.host)).toEqual(["reddit.com", "news.ycombinator.com"]);
  });

  it("gives a plain-English trust line from the dominant type", () => {
    expect(map.engines.find((e) => e.engine === "claude")!.trustLine).toBe(
      "builds answers from best-of listicles",
    );
    expect(map.engines.find((e) => e.engine === "perplexity")!.trustLine).toBe(
      "answers from community discussion",
    );
  });

  it("carries per-engine mention_rate through (including null)", () => {
    expect(map.engines.find((e) => e.engine === "perplexity")!.mentionRate).toBe(0);
    expect(map.engines.find((e) => e.engine === "chatgpt")!.mentionRate).toBe(0.75);
  });

  it("synthesis names the lowest-mention engine + its source type, honestly 'absent' at 0", () => {
    // perplexity has the lowest mention_rate (0) → community sources → absent
    expect(map.synthesis).toBe("Perplexity leans on community sources: where you're absent.");
  });

  it("says 'least present' when the weakest engine's mention_rate is above 0", () => {
    const m = buildSourceMap(corpus, { chatgpt: 0.75, claude: 0.2, perplexity: 0.6 });
    expect(m.synthesis).toBe("Claude leans on best-of listicles: where you're least present.");
  });

  it("returns no synthesis when no engine has a scored mention_rate", () => {
    const m = buildSourceMap(corpus, {});
    expect(m.synthesis).toBeNull();
    expect(m.engines).toHaveLength(3);
  });

  it("handles an empty corpus without throwing", () => {
    const m = buildSourceMap([], rates);
    expect(m.engines).toEqual([]);
    expect(m.synthesis).toBeNull();
  });

  it("breaks a dominant-type tie deterministically by type name", () => {
    const tied = buildSourceMap(
      [
        page({ url: "https://a.com/x", page_type: "listicle", cited_by: { gemini: 2 } }),
        page({ url: "https://b.com/x", page_type: "comparison", cited_by: { gemini: 2 } }),
      ],
      { gemini: 0.1 },
    );
    // comparison < listicle alphabetically → comparison wins the tie
    expect(tied.engines[0].dominantType).toBe("comparison");
  });
});

describe("buildSourceMap channelMix", () => {
  // three forum pages (brand on 1), one review page, one brand-owned page.
  const mixCorpus: SourceMapPage[] = [
    page({ url: "https://reddit.com/1", page_type: "forum", cited_by: { perplexity: 3 }, brand_present: true }),
    page({ url: "https://reddit.com/2", page_type: "forum", cited_by: { perplexity: 1 }, brand_present: false }),
    page({ url: "https://reddit.com/3", page_type: "forum", cited_by: { claude: 1 }, brand_present: null }),
    page({ url: "https://g2.com/x", page_type: "review_platform", cited_by: { chatgpt: 2 }, brand_present: false }),
    page({ url: "https://acme.com/docs", page_type: "brand_owned", cited_by: { chatgpt: 5 }, brand_present: true }),
  ];

  it("names the largest non-brand_owned channel with its page share and brand-presence count", () => {
    const m = buildSourceMap(mixCorpus, {});
    expect(m.channelMix).not.toBeNull();
    expect(m.channelMix!.type).toBe("forum");
    // computed noun comes from SOURCE_NOUN, never hardcoded in the view
    expect(m.channelMix!.noun).toBe("community sources");
    expect(m.channelMix!.pages).toBe(3);
    // brand_present === true only (false and null do not count)
    expect(m.channelMix!.brandPresent).toBe(1);
    // verified = brand_present true OR false (null excluded): 1 true + 1 false = 2
    expect(m.channelMix!.verified).toBe(2);
    expect(m.channelMix!.share).toBeCloseTo(3 / 5);
  });

  // A channel the brand is verified-present on ≥half the time. Presence ratio is
  // 2/3; whether it reads "present_not_named" turns ONLY on the mention rate.
  const presentCorpus: SourceMapPage[] = [
    page({ url: "https://reddit.com/1", page_type: "forum", cited_by: { perplexity: 2 }, brand_present: true }),
    page({ url: "https://reddit.com/2", page_type: "forum", cited_by: { claude: 1 }, brand_present: true }),
    page({ url: "https://reddit.com/3", page_type: "forum", cited_by: { chatgpt: 1 }, brand_present: false }),
  ];

  it("case (counted): verified pages but no scored rate → plain presence sentence", () => {
    // rates {} means overall mention rate is null → never the killer phrasing
    const m = buildSourceMap(presentCorpus, {});
    expect(m.channelMix!.appearance).toBe("counted");
    expect(m.channelMix!.sentence).toBe(
      "100% of the pages behind these answers are community sources. You appear on 2 of the 3 we could verify.",
    );
  });

  it("case (present_not_named): present on ≥half the verified pages AND a low mention rate", () => {
    const m = buildSourceMap(presentCorpus, { chatgpt: 0, claude: 0, perplexity: 0 });
    expect(m.channelMix!.appearance).toBe("present_not_named");
    expect(m.channelMix!.sentence).toBe(
      "100% of the pages behind these answers are community sources. You appear on 2 of the 3 we could verify, yet the engines still don't name you.",
    );
  });

  it("present_not_named wording is graduated: a positive-but-low rate says 'rarely', never 'don't'", () => {
    // engines DO sometimes name the brand (mean rate 0.25 < 0.34) — the
    // absolute "don't" would overclaim, which the honesty rules forbid
    const m = buildSourceMap(presentCorpus, { chatgpt: 0.25, claude: 0.25, perplexity: 0.25 });
    expect(m.channelMix!.appearance).toBe("present_not_named");
    expect(m.channelMix!.sentence).toBe(
      "100% of the pages behind these answers are community sources. You appear on 2 of the 3 we could verify, yet the engines still rarely name you.",
    );
  });

  it("present_not_named triggers ONLY on a low mention rate — a high rate stays 'counted'", () => {
    // same presence ratio (2/3), but mean rate 0.8 ≥ 0.34 → plain "counted"
    const m = buildSourceMap(presentCorpus, { chatgpt: 0.8, claude: 0.9, perplexity: 0.7 });
    expect(m.channelMix!.appearance).toBe("counted");
    expect(m.channelMix!.sentence).toBe(
      "100% of the pages behind these answers are community sources. You appear on 2 of the 3 we could verify.",
    );
  });

  it("case (unverified): no page could be verified → share sentence only", () => {
    const allNull = buildSourceMap(
      [
        page({ url: "https://youtube.com/1", page_type: "video", cited_by: { perplexity: 2 }, brand_present: null }),
        page({ url: "https://youtube.com/2", page_type: "video", cited_by: { claude: 1 }, brand_present: null }),
      ],
      { chatgpt: 0 },
    );
    expect(allNull.channelMix!.appearance).toBe("unverified");
    expect(allNull.channelMix!.sentence).toBe(
      "100% of the pages behind these answers are video content.",
    );
  });

  it("a channel of all-unverified (null) pages reports verified 0", () => {
    const allNull = buildSourceMap(
      [
        page({ url: "https://youtube.com/1", page_type: "video", cited_by: { perplexity: 2 }, brand_present: null }),
        page({ url: "https://youtube.com/2", page_type: "video", cited_by: { claude: 1 }, brand_present: null }),
      ],
      {},
    );
    expect(allNull.channelMix!.type).toBe("video");
    expect(allNull.channelMix!.verified).toBe(0);
    expect(allNull.channelMix!.brandPresent).toBe(0);
  });

  it("returns null channelMix on an empty corpus (verify runs)", () => {
    expect(buildSourceMap([], rates).channelMix).toBeNull();
  });

  it("returns null channelMix when every cited page is brand_owned", () => {
    const m = buildSourceMap(
      [
        page({ url: "https://acme.com/a", page_type: "brand_owned", cited_by: { chatgpt: 2 }, brand_present: true }),
        page({ url: "https://acme.com/b", page_type: "brand_owned", cited_by: { claude: 1 }, brand_present: true }),
      ],
      rates,
    );
    expect(m.channelMix).toBeNull();
  });
});
