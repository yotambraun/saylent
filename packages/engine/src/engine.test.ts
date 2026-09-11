// the spec (see METHODOLOGY.md) testing floor — robots parser + precedence, page classifier,
// coverage scorer, fix ranking order, judge JSON parsing on malformed outputs,
// smoke question selection, hand-computed score totals.
import { describe, expect, it } from "vitest";
import { classifyPage } from "./classify";
import { COVERAGE_THRESHOLD, bestCoverage, coverageScore } from "./coverage";
import { diagnose } from "./fixes";
import { buildVerdict } from "./judge";
import { selectQuestions } from "./profiles";
import { groupFor, isBlocked, mentionsAgent, parseRobots } from "./robots";
import { computeScores, watchNotes } from "./score";
import type { AnswerRow, BrandModel, CorpusPageRow, DomainCheck, Fix, Question } from "./types";
import { parseJsonLoosely } from "./util";

const bm: BrandModel = {
  brand: "Acme",
  domain: "acme.com",
  aliases: ["Acme", "acme"],
  category: "CDN",
  icp: "SaaS teams",
  products: [],
  value_props: ["fast"],
  problems: ["slow pages"],
  competitors: ["Rival", "Other"],
  language: "en",
};

// ---------- robots ----------
describe("robots parser + precedence (see METHODOLOGY.md)", () => {
  const txt = `
# comment line
User-agent: *
Disallow: /admin

User-agent: GPTBot
User-agent: ClaudeBot
Disallow: /

User-agent: PerplexityBot
Disallow:
`;
  const groups = parseRobots(txt);

  it("groups consecutive user-agent lines together", () => {
    expect(groups).toHaveLength(3);
    expect(groups[1].agents).toEqual(["gptbot", "claudebot"]);
  });
  it("specific group takes precedence over *", () => {
    expect(isBlocked(groups, "GPTBot")).toBe(true);
    expect(isBlocked(groups, "ClaudeBot")).toBe(true);
  });
  it("empty Disallow = allow", () => {
    expect(isBlocked(groups, "PerplexityBot")).toBe(false);
  });
  it("unlisted agents fall back to * (which does not block root here)", () => {
    expect(isBlocked(groups, "OAI-SearchBot")).toBe(false);
    expect(groupFor(groups, "OAI-SearchBot")?.agents).toEqual(["*"]);
  });
  it("no * group and no specific group ⇒ allowed", () => {
    expect(isBlocked(parseRobots("User-agent: X\nDisallow: /"), "GPTBot")).toBe(false);
  });
  it("detects deprecated agent mentions", () => {
    expect(mentionsAgent(parseRobots("User-agent: anthropic-ai\nDisallow: /"), "anthropic-ai")).toBe(true);
  });
});

// ---------- classifier ----------
describe("page classifier (see METHODOLOGY.md)", () => {
  const c = (host: string, title = "", url = `https://${host}/x`) =>
    classifyPage({ host, title, url, brandDomain: "acme.com" });
  it("host lists win first", () => {
    expect(c("www.g2.com")).toBe("review_platform");
    expect(c("old.reddit.com")).toBe("forum");
    expect(c("en.wikipedia.org")).toBe("wiki");
    expect(c("writing.stackexchange.com")).toBe("forum");
  });
  it("classifies video hosts (like listicles) before the regex types", () => {
    expect(c("youtube.com")).toBe("video");
    expect(c("www.youtube.com")).toBe("video");
    expect(c("youtu.be")).toBe("video");
    expect(c("vimeo.com")).toBe("video");
    // the host list wins even when the title would otherwise match a regex type
    expect(c("www.youtube.com", "Top 10 CDNs compared")).toBe("video");
  });
  it("keeps brand_owned when the brand's OWN domain is a video host (brand_owned before video)", () => {
    expect(
      classifyPage({ host: "youtube.com", title: "", url: "https://youtube.com/@brand", brandDomain: "youtube.com" }),
    ).toBe("brand_owned");
  });
  it("does not misclassify look-alike hosts as video (substring fallback removed)", () => {
    expect(classifyPage({ host: "youtu.beauty", title: "hello", url: "https://youtu.beauty/x", brandDomain: "acme.com" })).toBe("other");
  });
  it("classifies deep stackexchange subdomains as forum (stackexchange.com needle)", () => {
    expect(
      classifyPage({ host: "webmasters.stackexchange.com", title: "", url: "https://webmasters.stackexchange.com/q/1", brandDomain: "acme.com" }),
    ).toBe("forum");
  });
  it("brand_owned before title patterns", () => {
    expect(c("blog.acme.com", "Best CDN 2026")).toBe("brand_owned");
  });
  it("title/url patterns in order: listicle > comparison > docs > news", () => {
    expect(c("x.com", "Top 10 CDNs compared")).toBe("listicle");
    expect(c("x.com", "Acme vs Rival")).toBe("comparison");
    expect(c("x.com", "CDN documentation guide")).toBe("docs");
    expect(c("x.com", "Acme raises $10M")).toBe("news");
    expect(c("x.com", "hello world")).toBe("other");
  });
});

// ---------- coverage ----------
describe("coverage scorer (see METHODOLOGY.md)", () => {
  it("full overlap scores 1", () => {
    expect(coverageScore("best CDN pricing", "CDN pricing", "the best cdn pricing here")).toBe(1);
  });
  it("stopwords are stripped from the question", () => {
    expect(coverageScore("what is the best cdn", "", "cdn")).toBe(1); // only "cdn" survives
  });
  it("bestCoverage across pages, threshold semantics", () => {
    const pages = [
      { title: "pricing", text: "cdn pricing plans" },
      { title: "about", text: "our story" },
    ];
    expect(bestCoverage("cdn pricing plans comparison", pages)).toBeGreaterThanOrEqual(0.5);
    expect(bestCoverage("kubernetes operators tutorial", pages)).toBeLessThan(COVERAGE_THRESHOLD);
  });
});

// ---------- judge ----------
describe("judge verdicts (see METHODOLOGY.md)", () => {
  const answer = (text: string): AnswerRow => ({
    qid: "q01",
    qtype: "category",
    question: "best CDN?",
    engine: "chatgpt",
    ok: true,
    raw_text: text,
    citations: [],
  });

  it("malformed judge outputs degrade to safe verdicts (5 fixtures)", () => {
    const fixtures = [
      "```json\n{\"mention_type\":\"recommended\"\n```", // truncated inside fence
      "The brand is clearly recommended here.", // prose, no json
      '{"mention_type": "recommended", "prominence": "first"', // truncated json
      'prefix {"mention_type":"listed","sentiment":"positive"} suffix', // prose+json
      '{"mention_type":"banana","prominence":123,"claims":"not-an-array"}', // wrong types
    ];
    for (const raw of fixtures) {
      const v = buildVerdict(answer("We recommend Acme."), bm, parseJsonLoosely(raw));
      expect(v.brand_present).toBe(true);
      expect(["recommended", "listed", "compared", "neutral", "dismissed"]).toContain(v.mention_type);
      expect(v.claims).toBeInstanceOf(Array);
    }
  });

  it("judge may NOT overturn deterministic absence", () => {
    const v = buildVerdict(answer("Only Rival is mentioned."), bm, {
      mention_type: "recommended",
      prominence: "first",
      sentiment: "positive",
    });
    expect(v.brand_present).toBe(false);
    expect(v.mention_type).toBe("absent");
    expect(v.prominence).toBe("none");
  });

  it("null judge output yields neutral verdict with deterministic presence", () => {
    const v = buildVerdict(answer("Acme is fine."), bm, null);
    expect(v.brand_present).toBe(true);
    expect(v.mention_type).toBe("neutral");
    expect(v.excerpt).toContain("Acme");
  });

  // ---- E2a structured claims + other_brands ----
  it("parses NEW-shape structured claims with their kinds", () => {
    const v = buildVerdict(answer("Acme is fast but reviews criticize its support."), bm, {
      mention_type: "listed",
      claims: [
        { text: "Acme is fast", kind: "praise" },
        { text: "Reviews criticize slow support", kind: "risk" },
        { text: "Starts at $10/mo", kind: "neutral_fact" },
      ],
      other_brands: [{ name: "Rival", why: "cheaper enterprise pricing" }],
    });
    expect(v.claims).toEqual([
      { text: "Acme is fast", kind: "praise" },
      { text: "Reviews criticize slow support", kind: "risk" },
      { text: "Starts at $10/mo", kind: "neutral_fact" },
    ]);
    expect(v.other_brands).toEqual([{ name: "Rival", why: "cheaper enterprise pricing" }]);
  });

  it("coerces OLD-shape string claims/other_brands (kind neutral_fact, why '')", () => {
    const v = buildVerdict(answer("Acme is fine."), bm, {
      mention_type: "listed",
      claims: ["Acme has a free tier", "Acme is EU-hosted"],
      other_brands: ["Rival", "Other"],
    });
    expect(v.claims).toEqual([
      { text: "Acme has a free tier", kind: "neutral_fact" },
      { text: "Acme is EU-hosted", kind: "neutral_fact" },
    ]);
    expect(v.other_brands).toEqual([
      { name: "Rival", why: "" },
      { name: "Other", why: "" },
    ]);
  });

  it("invalid kind falls back to neutral_fact; empty text/name and junk are dropped", () => {
    const v = buildVerdict(answer("Acme is fine."), bm, {
      mention_type: "listed",
      claims: [
        { text: "Solid uptime", kind: "banana" }, // bad kind → neutral_fact
        { text: "   ", kind: "risk" }, // empty text → dropped
        { kind: "praise" }, // no text → dropped
        42, // junk → dropped
      ],
      other_brands: [{ name: "" }, { why: "x" }, { name: "Rival", why: 7 }],
    });
    expect(v.claims).toEqual([{ text: "Solid uptime", kind: "neutral_fact" }]);
    expect(v.other_brands).toEqual([{ name: "Rival", why: "" }]); // why non-string → ""
  });

  it("enforces caps: ≤7 claims, ≤8 other_brands", () => {
    const v = buildVerdict(answer("Acme is fine."), bm, {
      mention_type: "listed",
      claims: Array.from({ length: 12 }, (_, i) => ({ text: `c${i}`, kind: "neutral_fact" })),
      other_brands: Array.from({ length: 15 }, (_, i) => ({ name: `B${i}`, why: "" })),
    });
    expect(v.claims).toHaveLength(7);
    expect(v.other_brands).toHaveLength(8);
  });
});

// ---------- fixes ----------
describe("fix ranking (see METHODOLOGY.md)", () => {
  const q: Question[] = [
    { qid: "q01", text: "best CDN for SaaS teams?", qtype: "category" },
    { qid: "q09", text: "Acme vs Rival?", qtype: "comparison" },
    { qid: "q18", text: "What is Acme? Is it any good?", qtype: "branded" },
  ];
  const answers: AnswerRow[] = [
    {
      qid: "q01", qtype: "category", question: q[0].text, engine: "chatgpt", ok: true,
      raw_text: "Rival is best", citations: [],
      verdict: { brand_present: false, mention_type: "absent", prominence: "none", sentiment: "neutral", claims: [], other_brands: [{ name: "Rival", why: "" }], excerpt: "" },
    },
  ];
  const corpus: CorpusPageRow[] = [
    {
      url: "https://big.com/best-cdn", final_url: "https://big.com/best-cdn", title: "Best CDNs",
      page_type: "listicle", cited_by: { chatgpt: 6 }, cited_for_qids: ["q01"], fetch_status: 200,
      brand_present: false, brand_context: null, competitors_present: ["Rival"], opportunity: true,
    },
  ];
  const checks: DomainCheck[] = [
    { check: "live fetch as PerplexityBot", status: "fail", detail: "403 while robots allows", factor: "access_blocked" },
    { check: "content coverage", status: "fail", detail: "gaps: [q01] best CDN for SaaS teams?", factor: "coverage_gap" },
    { check: "JSON-LD Organization", status: "fail", detail: "missing", factor: "schema_missing" },
    { check: "homepage entity clarity", status: "warn", detail: "unclear", factor: "entity_unclear" },
    { check: "freshness", status: "warn", detail: "stale title", factor: "freshness_stale" },
  ];

  it("orders access → coverage → source → entity → schema → freshness by weight", () => {
    const fixes = diagnose(bm, q, answers, corpus, checks);
    const factors = fixes.map((f) => f.factor);
    expect(factors[0]).toBe("access_blocked"); // 9.5
    expect(factors[1]).toBe("coverage_gap"); // 9.0
    expect(factors[2]).toBe("citation_source_gap"); // 8.5 + 0.5
    expect(fixes[2].weight).toBeCloseTo(9.0, 5); // capped cites: 8.5 + 5×0.1
    expect(factors.indexOf("entity_unclear")).toBeLessThan(factors.indexOf("schema_missing")); // 7.0 > 5.5
    expect(factors[factors.length - 1]).toBe("freshness_stale"); // 4.0
  });

  it("every title starts with a verb-ish capital and evidence carries qid links", () => {
    const fixes = diagnose(bm, q, answers, corpus, checks);
    for (const f of fixes) expect(/^[A-Z]/.test(f.title)).toBe(true);
    const page = fixes.find((f) => f.fixKey === "coverage-hub");
    expect(page?.evidence.join(" ")).toContain("[q01]");
  });

  it("archive-rescued opportunity page → fix title/key name the ORIGINAL host, not web.archive.org", () => {
    const archiveCorpus: CorpusPageRow[] = [
      {
        url: "https://reddit.com/r/cdn/best",
        final_url: "https://web.archive.org/web/20240101000000id_/https://reddit.com/r/cdn/best",
        title: "cdn thread", page_type: "forum", cited_by: { perplexity: 3 },
        cited_for_qids: ["q01"], fetch_status: 200, brand_present: false, brand_context: null,
        competitors_present: ["Rival"], opportunity: true,
      },
    ];
    const fixes = diagnose(bm, [], [], archiveCorpus, []);
    const source = fixes.find((f) => f.factor === "citation_source_gap");
    expect(source?.fixKey).toBe("source-reddit.com");
    expect(source?.title).toContain("reddit.com");
    expect(source?.title).not.toContain("web.archive.org");
  });
});

// ---------- fix engine amendment (citation-mix weighting) ----------
describe("evidence-driven fixes: clustered hub + citation-mix weights", () => {
  const q: Question[] = [
    { qid: "q01", text: "best CDN for SaaS teams?", qtype: "category" },
    { qid: "q09", text: "Rival vs Other — which is better?", qtype: "comparison" },
    { qid: "q14", text: "How do I fix slow pages?", qtype: "problem" },
  ];
  const coverageChecks: DomainCheck[] = [
    {
      check: "content coverage",
      status: "fail",
      detail: "gaps: [q01] best CDN? [q09] Rival vs Other? [q14] slow pages?",
      factor: "coverage_gap",
    },
  ];
  const page = (page_type: string, i: number, cites = 1): CorpusPageRow => ({
    url: `https://site${i}.com/p`, final_url: `https://site${i}.com/p`, title: `P${i}`,
    page_type, cited_by: { chatgpt: cites }, cited_for_qids: ["q01"], fetch_status: 200,
    brand_present: false, brand_context: null, competitors_present: ["Rival"], opportunity: i === 0,
  });

  it("clusters ALL uncovered questions into ONE hub fix (never one 'X vs Y' page per question)", () => {
    const fixes = diagnose(bm, q, [], [], coverageChecks);
    const coverage = fixes.filter((f) => f.factor === "coverage_gap");
    expect(coverage).toHaveLength(1);
    expect(coverage[0].fixKey).toBe("coverage-hub");
    expect(coverage[0].title).not.toContain(" vs ");
    const ev = coverage[0].evidence.join(" ");
    for (const qid of ["q01", "q09", "q14"]) expect(ev).toContain(`[${qid}]`);
  });

  it("when third-party pages dominate the brand's citations, pitch fixes outrank the hub", () => {
    const corpus = [
      ...[0, 1, 2, 3, 4, 5].map((i) => page("listicle", i)),
      page("brand_owned", 6),
      page("brand_owned", 7),
    ]; // t = 6/8 = 0.75
    const fixes = diagnose(bm, q, [], corpus, coverageChecks);
    const hub = fixes.find((f) => f.factor === "coverage_gap")!;
    const source = fixes.find((f) => f.factor === "citation_source_gap")!;
    expect(source.weight).toBeGreaterThan(hub.weight);
    expect(hub.evidence.join(" ")).toContain("75%");
  });

  it("when the brand's own pages dominate citations, the hub outranks pitching", () => {
    const corpus = [
      ...[0, 1, 2, 3, 4, 5].map((i) => page("brand_owned", i)),
      page("listicle", 6),
      page("listicle", 7),
    ]; // t = 2/8 = 0.25
    const fixes = diagnose(bm, q, [], corpus, coverageChecks);
    const hub = fixes.find((f) => f.factor === "coverage_gap")!;
    const source = fixes.find((f) => f.factor === "citation_source_gap")!;
    expect(hub.weight).toBeGreaterThan(source.weight);
  });

  it("with fewer than 5 cited pages there is no re-weighting (static spec weights)", () => {
    const fixes = diagnose(bm, q, [], [page("listicle", 0)], coverageChecks);
    expect(fixes.find((f) => f.factor === "coverage_gap")!.weight).toBe(9.0);
    expect(fixes.find((f) => f.factor === "citation_source_gap")!.weight).toBeCloseTo(8.6, 5);
  });

  it("watch notes still parse every qid from the clustered hub evidence", () => {
    const fixes = diagnose(bm, q, [], [], coverageChecks);
    const hub = { ...fixes.find((f) => f.fixKey === "coverage-hub")!, publishedAt: "2026-07-08" };
    const mkA = (qid: string, present: boolean): AnswerRow => ({
      qid, qtype: "category", question: "x", engine: "chatgpt", ok: true, raw_text: "", citations: [],
      verdict: { brand_present: present, mention_type: present ? "listed" : "absent", prominence: "none", sentiment: "neutral", claims: [], other_brands: [], excerpt: "" },
    });
    const notes = watchNotes(
      [hub],
      [mkA("q01", false), mkA("q09", false), mkA("q14", false)],
      [mkA("q01", true), mkA("q09", true), mkA("q14", false)],
    );
    expect(notes[0].newlyPresentQids.sort()).toEqual(["q01", "q09"]);
  });
});

// ---------- smoke selection ----------
describe("smoke question selection (see METHODOLOGY.md)", () => {
  const frozen: Question[] = [
    ...["category", "category", "category"].map((t, i) => ({ qid: `q0${i + 1}`, text: `c${i}`, qtype: t as Question["qtype"] })),
    { qid: "q09", text: "cmp0", qtype: "comparison" },
    { qid: "q10", text: "cmp1", qtype: "comparison" },
    { qid: "q14", text: "p0", qtype: "problem" },
    { qid: "q18", text: "b0", qtype: "branded" },
  ];
  it("picks first of each type then fills with category+comparison to 6, deterministically", () => {
    const s1 = selectQuestions(frozen, "smoke");
    const s2 = selectQuestions(frozen, "smoke");
    expect(s1.map((q) => q.qid)).toEqual(s2.map((q) => q.qid));
    expect(s1).toHaveLength(6);
    expect(new Set(s1.map((q) => q.qtype))).toEqual(new Set(["category", "comparison", "problem", "branded"]));
    expect(selectQuestions(frozen, "full")).toBe(frozen); // untouched
  });
});

// ---------- scores ----------
describe("score computation (see METHODOLOGY.md) — hand-computed totals", () => {
  const mk = (engine: AnswerRow["engine"], qid: string, qtype: AnswerRow["qtype"], ok: boolean, mention?: string, present = false): AnswerRow => ({
    qid, qtype, question: "x", engine, ok, raw_text: "", citations: [],
    ...(mention
      ? { verdict: { brand_present: present, mention_type: mention as never, prominence: "early", sentiment: "neutral", claims: [], other_brands: [{ name: "Rival", why: "" }, { name: "Other", why: "" }], excerpt: "" } }
      : {}),
  });
  const answers: AnswerRow[] = [
    mk("chatgpt", "q01", "category", true, "recommended", true),
    mk("chatgpt", "q02", "problem", true, "listed", true),
    mk("chatgpt", "q09", "comparison", true, "recommended", true), // comparison — NOT scored
    mk("gemini", "q01", "category", true, "absent", false),
    mk("gemini", "q02", "problem", false), // failed — not answered
    mk("claude", "q18", "branded", true, "recommended", true), // branded — NOT scored
  ];
  it("scores category+problem only; rates null when answered=0", () => {
    const s = computeScores(answers);
    expect(s.per_engine.chatgpt).toEqual({ answered: 2, recommended: 1, mentioned: 2, rec_rate: 0.5, mention_rate: 1 });
    expect(s.per_engine.gemini).toEqual({ answered: 1, recommended: 0, mentioned: 0, rec_rate: 0, mention_rate: 0 });
    expect(s.per_engine.perplexity.rec_rate).toBeNull();
    expect(s.overall.answered).toBe(3);
    expect(s.overall.recommended).toBe(1);
    expect(s.share_of_voice.Rival).toBe(5); // every verdict lists Rival (5 verdicts)
  });
  it("watch notes: movement counted only on newly-present evidence qids", () => {
    const fix: Fix = {
      fixKey: "page-q01", title: "Publish", factor: "coverage_gap", weight: 9, effort: "M",
      timeToImpact: "2–4 weeks", engines: ["gemini"], evidence: ["[q01] gap"],
    };
    const baseline = [mk("gemini", "q01", "category", true, "absent", false)];
    const current = [mk("gemini", "q01", "category", true, "listed", true)];
    const notes = watchNotes([fix], baseline, current);
    expect(notes[0].newlyPresentQids).toEqual(["q01"]);
    const none = watchNotes([fix], current, current);
    expect(none[0].note).toContain("no movement yet");
  });
});

// ---- crawler extraction + honesty guard (post-incident regression coverage) ----
import * as cheerio from "cheerio";
import { buildCorpus } from "./corpus";
import { extractLdTypes } from "./crawl";
import { runDomainChecks } from "./domainChecks";
import type { DbWriter, SitePage } from "./types";

describe("extract-at-source crawler (post-mortem regression coverage)", () => {
  it("finds JSON-LD at ANY position in a huge document (end-of-body included)", () => {
    const huge =
      "<html><head><title>t</title></head><body>" +
      "x".repeat(500_000) + // far beyond any byte cap
      '<script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>' +
      "</body></html>";
    expect(extractLdTypes(cheerio.load(huge))).toContain("organization");
  });

  it("zero-page crawl yields ONE honest warn and NO confident page-level fails", async () => {
    const saved: DomainCheck[] = [];
    const db = {
      setStage: async () => {},
      saveAnswer: async () => {},
      saveCorpusPage: async () => {},
      saveCheck: async (c: DomainCheck) => {
        saved.push(c);
      },
      saveFix: async () => {},
      finishRun: async () => {},
      failRun: async () => {},
    } as unknown as DbWriter;
    const fetcher = async () => ({ status: 403, finalUrl: "https://x.example/", text: "" });
    const checks = await runDomainChecks(
      { brand: "X", domain: "x.example", aliases: ["X"], category: "testing tools", icp: "t", products: [], value_props: [], problems: [], competitors: [], language: "en" },
      [{ qid: "q01", qtype: "category", text: "best testing tools" } as Question],
      [] as SitePage[],
      db,
      "run-test",
      { currentYear: 2026, fetcher: fetcher as never },
    );
    const crawlWarn = checks.find((c) => c.check === "site crawl");
    expect(crawlWarn?.status).toBe("warn");
    // no false "schema missing" / "coverage" fails from an empty crawl
    expect(checks.find((c) => c.check.startsWith("JSON-LD"))).toBeUndefined();
    expect(checks.find((c) => c.check === "content coverage")).toBeUndefined();
    expect(saved.length).toBe(checks.length);
  });
});

describe("share-of-voice brand canonicalization", () => {
  it("folds Apollo.io into Apollo and strips parentheticals", async () => {
    const { canonicalBrand, computeScores } = await import("./score");
    expect(canonicalBrand("Apollo.io")).toBe("apollo");
    expect(canonicalBrand("Clearbit (Breeze Intelligence)")).toBe("clearbit");
    const mk = (brands: string[]): AnswerRow =>
      ({ qid: "q01", qtype: "category", question: "x", engine: "chatgpt", ok: true,
         raw_text: "", citations: [], verdict: { brand_present: false, mention_type: "absent",
         prominence: "none", sentiment: "neutral", claims: [], other_brands: brands, excerpt: "" },
      }) as unknown as AnswerRow;
    const s = computeScores([mk(["Apollo"]), mk(["Apollo.io"]), mk(["Apollo"])]);
    expect(s.share_of_voice["Apollo"]).toBe(3);
    expect(s.share_of_voice["Apollo.io"]).toBeUndefined();
  });
});

describe("SOV word-suffix variant merge", () => {
  it("folds 'Sales Navigator' into 'LinkedIn Sales Navigator'", async () => {
    const { computeScores } = await import("./score");
    const mk = (brands: string[]): AnswerRow =>
      ({ qid: "q01", qtype: "category", question: "x", engine: "chatgpt", ok: true,
         raw_text: "", citations: [], verdict: { brand_present: false, mention_type: "absent",
         prominence: "none", sentiment: "neutral", claims: [], other_brands: brands, excerpt: "" },
      }) as unknown as AnswerRow;
    const s = computeScores([
      mk(["LinkedIn Sales Navigator"]),
      mk(["Sales Navigator"]),
      mk(["LinkedIn Sales Navigator"]),
    ]);
    expect(s.share_of_voice["LinkedIn Sales Navigator"]).toBe(3);
    expect(s.share_of_voice["Sales Navigator"]).toBeUndefined();
  });
});

// ---------- notifications (copy + never-throw guard) ----------
// Notification-copy + createDbWriter tests moved to src/lib/db.test.ts
// (open-source workspace move, 2026-09-09): they exercise the app-bound db.ts
// (imports @supabase/supabase-js), which packages/engine must not import.

describe("E2a: SOV identical for old-shape and new-shape other_brands", () => {
  it("string[] rows and {name,why}[] rows produce the same share_of_voice", async () => {
    const { computeScores } = await import("./score");
    const mk = (others: unknown): AnswerRow =>
      ({ qid: "q01", qtype: "category", question: "x", engine: "chatgpt", ok: true,
         raw_text: "", citations: [], verdict: { brand_present: false, mention_type: "absent",
         prominence: "none", sentiment: "neutral", claims: [], other_brands: others, excerpt: "" },
      }) as unknown as AnswerRow;
    const old = computeScores([mk(["Rival", "Other"]), mk(["Rival"]), mk(["Other"])]);
    const neu = computeScores([
      mk([{ name: "Rival", why: "cheaper" }, { name: "Other", why: "" }]),
      mk([{ name: "Rival", why: "faster" }]),
      mk([{ name: "Other", why: "" }]),
    ]);
    expect(neu.share_of_voice).toEqual(old.share_of_voice);
    expect(old.share_of_voice.Rival).toBe(2);
    expect(old.share_of_voice.Other).toBe(2);
  });
});

describe("corpus Wayback fallback for blocked cited pages (citation-channels)", () => {
  const bmCdn: BrandModel = {
    brand: "Acme", domain: "acme.com", aliases: ["Acme", "acme"], category: "CDN",
    icp: "SaaS teams", products: [], value_props: ["fast"], problems: ["slow"],
    competitors: ["Rival", "Other"], language: "en",
  };
  const answers: AnswerRow[] = [
    {
      qid: "q01", qtype: "category", question: "best cdn", engine: "chatgpt", ok: true,
      raw_text: "", citations: [{ url: "https://reddit.com/r/cdn/best", title: "cdn thread" }],
    },
  ];
  const collectDb = () => {
    const rows: (CorpusPageRow & { runId: string })[] = [];
    const db = {
      setStage: async () => {},
      saveCorpusPage: async (r: CorpusPageRow & { runId: string }) => {
        rows.push(r);
      },
    } as unknown as DbWriter;
    return { db, rows };
  };

  it("(a) live 403 → archive snapshot read; final_url is the resolved capture, identity stays reddit (forum)", async () => {
    // Wayback 302-redirects the id_ URL to the nearest concrete capture — the row
    // must point final_url at the copy actually read (ares.finalUrl), while
    // identity (host, page_type, merge key) unwraps back to the original reddit url.
    const resolved = "https://web.archive.org/web/20240101000000/https://reddit.com/r/cdn/best";
    const fetcher = async (url: string) => {
      if (url.includes("archive.org/wayback/available"))
        return {
          status: 200, finalUrl: url,
          text: JSON.stringify({ archived_snapshots: { closest: { available: true, timestamp: "20240101000000" } } }),
        };
      if (url.startsWith("https://web.archive.org/web/"))
        return { status: 200, finalUrl: resolved, text: "<title>CDN thread</title><body>Acme is great, better than Rival</body>" };
      return { status: 403, finalUrl: url, text: "" };
    };
    const { db, rows } = collectDb();
    const out = await buildCorpus(answers, bmCdn, db, "run-1", { fetcher });
    expect(out).toHaveLength(1);
    expect(out[0].final_url).toBe(resolved);
    expect(out[0].page_type).toBe("forum");
    expect(out[0].fetch_status).toBe(200);
    expect(out[0].brand_present).toBe(true);
    expect(out[0].competitors_present).toContain("Rival");
    expect(out[0].title).toBe("CDN thread");
    expect(rows[0].final_url).toBe(resolved); // persisted row lands the reader on the archive copy
  });

  it("(b) live 403 → no archive snapshot → row unchanged (unverified)", async () => {
    const fetcher = async (url: string) => {
      if (url.includes("archive.org/wayback/available"))
        return { status: 200, finalUrl: url, text: JSON.stringify({ archived_snapshots: {} }) };
      return { status: 403, finalUrl: url, text: "" };
    };
    const { db } = collectDb();
    const out = await buildCorpus(answers, bmCdn, db, "run-2", { fetcher });
    expect(out).toHaveLength(1);
    expect(out[0].brand_present).toBeNull();
    expect(out[0].fetch_status).toBe(403);
    expect(out[0].competitors_present).toEqual([]);
  });

  it("(c) live 200 → archive is never consulted", async () => {
    let archiveCalls = 0;
    const fetcher = async (url: string) => {
      if (url.includes("archive.org")) {
        archiveCalls++;
        return { status: 200, finalUrl: url, text: "{}" };
      }
      return { status: 200, finalUrl: url, text: "<title>Live</title><body>Acme rocks</body>" };
    };
    const { db } = collectDb();
    const out = await buildCorpus(answers, bmCdn, db, "run-3", { fetcher });
    expect(archiveCalls).toBe(0);
    expect(out[0].brand_present).toBe(true);
    expect(out[0].final_url).toBe("https://reddit.com/r/cdn/best");
  });

  it("(d) same page cited directly and via a resolved wrapper (both 403, archive hit) → ONE merged row, summed cited_by", async () => {
    const redditUrl = "https://reddit.com/r/cdn/best";
    const wrapperUrl = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc";
    const snapUrl = "https://web.archive.org/web/20240101000000id_/https://reddit.com/r/cdn/best";
    const mergeAnswers: AnswerRow[] = [
      { qid: "q01", qtype: "category", question: "best cdn", engine: "chatgpt", ok: true, raw_text: "", citations: [{ url: redditUrl, title: "cdn thread" }] },
      { qid: "q02", qtype: "category", question: "cdn?", engine: "claude", ok: true, raw_text: "", citations: [{ url: wrapperUrl, title: "cdn thread" }] },
    ];
    const fetcher = async (url: string) => {
      if (url.includes("archive.org/wayback/available"))
        return { status: 200, finalUrl: url, text: JSON.stringify({ archived_snapshots: { closest: { available: true, timestamp: "20240101000000" } } }) };
      if (url.startsWith("https://web.archive.org/web/"))
        return { status: 200, finalUrl: snapUrl, text: "<title>CDN thread</title><body>Acme beats Rival</body>" };
      // both the direct reddit url AND the wrapper resolve (via redirects) to reddit, then 403
      return { status: 403, finalUrl: redditUrl, text: "" };
    };
    const { db } = collectDb();
    const out = await buildCorpus(mergeAnswers, bmCdn, db, "run-merge", { fetcher });
    expect(out).toHaveLength(1);
    expect(out[0].cited_by).toEqual({ chatgpt: 1, claude: 1 });
    expect(out[0].page_type).toBe("forum");
    expect(out[0].brand_present).toBe(true);
  });

  it("(e) archive availability is queried with the RESOLVED target, never the raw wrapper", async () => {
    const wrapperUrl = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc";
    const redditUrl = "https://reddit.com/r/cdn/best";
    const seen: string[] = [];
    const fetcher = async (url: string) => {
      seen.push(url);
      if (url.includes("archive.org/wayback/available"))
        return { status: 200, finalUrl: url, text: JSON.stringify({ archived_snapshots: {} }) };
      // the wrapper resolves to reddit, then 403 (safeFetch returns finalUrl even on failure)
      return { status: 403, finalUrl: redditUrl, text: "" };
    };
    const wrapAnswers: AnswerRow[] = [
      { qid: "q01", qtype: "category", question: "best cdn", engine: "chatgpt", ok: true, raw_text: "", citations: [{ url: wrapperUrl, title: "t" }] },
    ];
    const { db } = collectDb();
    await buildCorpus(wrapAnswers, bmCdn, db, "run-wrap", { fetcher });
    const availabilityCall = seen.find((u) => u.includes("archive.org/wayback/available"));
    expect(availabilityCall).toContain(encodeURIComponent(redditUrl));
    expect(availabilityCall).not.toContain(encodeURIComponent(wrapperUrl));
  });

  it("(f) a fetched video shell stays unverified — page_type video, brand_present null (never a guessed absence)", async () => {
    const videoAnswers: AnswerRow[] = [
      { qid: "q01", qtype: "category", question: "best cdn", engine: "chatgpt", ok: true, raw_text: "", citations: [{ url: "https://www.youtube.com/watch?v=abc", title: "CDN review" }] },
    ];
    // the shell even NAMES the brand + a rival, yet video presence is enforced-null
    const fetcher = async (url: string) => ({ status: 200, finalUrl: url, text: "<title>CDN review - YouTube</title><body>Acme is the best, better than Rival.</body>" });
    const { db } = collectDb();
    const out = await buildCorpus(videoAnswers, bmCdn, db, "run-vid", { fetcher });
    expect(out[0].page_type).toBe("video");
    expect(out[0].brand_present).toBeNull();
    expect(out[0].competitors_present).toEqual([]);
  });
});
