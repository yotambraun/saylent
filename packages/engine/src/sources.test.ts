import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { citationHost } from "./citation-host";
import {
  type SourceAnswerInput,
  buildSourceHistory,
  buildSourceIntelligence,
  makeDomainClassifier,
  pageKey,
  readStoredSources,
  sourceHost,
} from "./sources";

const brand = { name: "Acme Monitor", domain: "acme.example", aliases: ["Acme Monitor", "Acme"], competitors: ["Rivalry", "Beacon Uptime"] };

const absent = (rivals: { name: string; why?: string }[]) => ({
  brand_present: false,
  mention_type: "absent",
  other_brands: rivals.map((r) => ({ name: r.name, why: r.why ?? "" })),
  excerpt: "",
});
const present = (mention: "recommended" | "listed", rivals: string[] = []) => ({
  brand_present: true,
  mention_type: mention,
  other_brands: rivals.map((name) => ({ name, why: "" })),
  excerpt: "Acme Monitor is a solid pick",
});

const answers: SourceAnswerInput[] = [
  {
    qid: "q01",
    engine: "chatgpt",
    qtype: "category",
    question: "best uptime monitor?",
    ok: true,
    citations: [
      { url: "https://www.g2.com/categories/uptime" },
      { url: "https://listsite.example/best-uptime-tools" },
      { url: "https://rivalry.example/pricing" },
    ],
    verdict: absent([{ name: "Rivalry", why: "generous free tier" }, { name: "Beacon Uptime" }]),
  },
  {
    qid: "q01",
    engine: "google_ai_overview",
    qtype: "category",
    question: "best uptime monitor?",
    ok: true,
    citations: [{ url: "https://listsite.example/best-uptime-tools?utm_source=x" }, { url: "https://forum.example/t/uptime" }],
    verdict: absent([{ name: "Rivalry" }]),
  },
  {
    qid: "q02",
    engine: "claude",
    qtype: "problem",
    question: "how do I get paged when my site is down?",
    ok: true,
    citations: [{ url: "https://acme.example/docs/alerts" }, { url: "https://listsite.example/best-uptime-tools" }],
    verdict: present("recommended", ["Rivalry"]),
  },
  {
    qid: "q03",
    engine: "chatgpt",
    qtype: "branded",
    question: "is Acme Monitor any good?",
    ok: true,
    citations: [{ url: "https://reviews-blog.example/acme-review" }],
    verdict: absent([{ name: "Rivalry" }]),
  },
  {
    qid: "q04",
    engine: "claude",
    qtype: "category",
    question: "uptime tools compared",
    ok: true,
    citations: [{ url: "https://onpage.example/compare" }],
    verdict: absent([{ name: "Beacon Uptime" }]),
  },
  // failed and unjudged rows never count
  { qid: "q05", engine: "gemini", qtype: "category", question: "x", ok: false, citations: [{ url: "https://ghost.example/" }] },
  {
    qid: "q06",
    engine: "copilot",
    qtype: "category",
    question: "uptime vendors",
    ok: true,
    citations: [{ url: "https://news.example.com/uptime-funding" }],
    verdict: present("listed"),
  },
];

const corpus = [
  {
    url: "https://listsite.example/best-uptime-tools",
    final_url: "https://listsite.example/best-uptime-tools",
    title: "10 Best Uptime Tools",
    page_type: "listicle",
    brand_present: false,
    competitors_present: ["Rivalry"],
  },
  // brand verified ON this page: never an off-site gap
  {
    url: "https://onpage.example/compare",
    final_url: null,
    title: "Uptime tools compared",
    page_type: "comparison",
    brand_present: true,
    competitors_present: ["Beacon Uptime"],
  },
];

describe("classifyDomain rule set", () => {
  const classify = makeDomainClassifier({
    brandDomain: "acme.example",
    competitors: ["Rivalry", "Beacon Uptime"],
    namedRivals: ["Falconware AI"],
    overrides: { domainTypes: { "partner.example": "marketplace", "news.example.com": "editorial" } },
  });
  it.each([
    ["acme.example", "own_site", "your domain"],
    ["docs.acme.example", "own_site", "your domain"],
    ["g2.com", "review_site", "known review site"],
    ["www.reddit.com", "forum", "known community site"],
    ["en.wikipedia.org", "reference", "known reference site"],
    ["amazon.co.uk", "marketplace", "known marketplace"],
    ["linkedin.com", "social", "known social network"],
    ["rivalry.example", "rival_site", "named after Rivalry"],
    ["falconware.example", "rival_site", "named after Falconware AI"],
    ["status.beaconapp.example", "rival_site", 'host contains "beacon" (Beacon Uptime)'],
    ["help.somevendor.example", "docs", "docs/help subdomain"],
    ["community.thing.example", "forum", "community subdomain"],
    ["partner.example", "marketplace", "your override"],
    ["shop.partner.example", "marketplace", "your override for partner.example"],
    ["news.example.com", "editorial", "your override"],
    ["unknown.example", "other", "no rule matched"],
  ])("%s → %s (%s)", (host, type, rule) => {
    const c = classify(host);
    expect(c.type).toBe(type);
    expect(c.rule).toBe(rule);
  });

  it("falls back to what the cited pages look like, and says so", () => {
    const c = classify("listsite.example", new Map([["listicle", 3], ["other", 1]]));
    expect(c).toEqual({ type: "editorial", rule: "3 of 4 citations point to best-of listicles" });
    expect(classify("mixed.example", new Map([["listicle", 1], ["other", 3]])).type).toBe("other");
  });
});

describe("buildSourceIntelligence", () => {
  const intel = buildSourceIntelligence({ brand, answers, corpus });

  it("counts only ok answers, one per (question, engine)", () => {
    expect(intel.totals.answers).toBe(6);
    expect(intel.totals.citations).toBe(10);
    expect(intel.domains.reduce((s, d) => s + d.citations, 0)).toBe(intel.totals.citations);
    expect(intel.domains.find((d) => d.host === "ghost.example")).toBeUndefined();
  });

  it("joins tracking-param URLs onto the same page and domain", () => {
    const list = intel.domains.find((d) => d.host === "listsite.example")!;
    expect(list.citations).toBe(3);
    expect(list.answers).toBe(3);
    expect(list.pages).toHaveLength(1);
    expect(list.pages[0]).toMatchObject({ citations: 3, brandOnPage: false, rivalsOnPage: ["Rivalry"], title: "10 Best Uptime Tools" });
    expect(list.byEngine).toEqual({ chatgpt: 1, google_ai_overview: 1, claude: 1 });
    expect(list.share).toBeCloseTo(0.3);
    expect(list.type).toBe("editorial");
    expect(list.brandNamedAnswers).toBe(1);
    expect(list.rivalWonAnswers).toBe(2);
  });

  it("share of voice is counts with receipts", () => {
    const me = intel.voice.find((v) => v.isBrand)!;
    expect(me).toMatchObject({ name: "Acme Monitor", named: 2, recommended: 1 });
    expect(me.refs).toEqual([
      { qid: "q02", engine: "claude" },
      { qid: "q06", engine: "copilot" },
    ]);
    const rivalry = intel.voice.find((v) => v.name === "Rivalry")!;
    expect(rivalry.named).toBe(4);
    expect(rivalry.recommended).toBeNull();
    expect(rivalry.byEngine).toEqual({ chatgpt: 2, google_ai_overview: 1, claude: 1 });
    expect(intel.voice[0].name).toBe("Rivalry"); // most named first
  });

  it("opportunities: off-site, rival-won, category-stage, brand not on the page", () => {
    const hosts = intel.opportunities.map((o) => o.host);
    // listsite: 2 rival-won answers (q01 chatgpt + q01 aio); g2 + forum: 1 each
    expect(hosts[0]).toBe("listsite.example");
    expect(hosts).toEqual(expect.arrayContaining(["g2.com", "forum.example"]));
    expect(hosts).not.toContain("rivalry.example"); // a rival's own site
    expect(hosts).not.toContain("acme.example"); // your own site
    expect(hosts).not.toContain("reviews-blog.example"); // only a branded question cites it
    expect(hosts).not.toContain("onpage.example"); // you are verified on it
    expect(hosts).not.toContain("news.example.com"); // the answer citing it names you
    const top = intel.opportunities[0];
    expect(top).toMatchObject({
      evidence: 2,
      engines: ["chatgpt", "google_ai_overview"],
      qids: ["q01"],
      pageCheck: "rivals_on_page",
      pagesRead: 1,
      rivalsOnPages: ["Rivalry"],
      brandNamedAnswers: 1,
      topPage: { url: "https://listsite.example/best-uptime-tools", title: "10 Best Uptime Tools" },
    });
    expect(top.rivals[0]).toEqual({ name: "Rivalry", count: 2 });
    expect(top.receipts[0]).toMatchObject({
      qid: "q01",
      engine: "chatgpt",
      question: "best uptime monitor?",
      urls: ["https://listsite.example/best-uptime-tools"],
      rivals: [{ name: "Rivalry", why: "generous free tier" }, { name: "Beacon Uptime", why: "" }],
    });
    expect(top.why).toBe(
      "Cited in 2 answers that name Rivalry and Beacon Uptime and not you, across 2 engines and 1 question. We read 1 page on it: Rivalry is there, you are not.",
    );
    expect(intel.opportunities.find((o) => o.host === "g2.com")?.pageCheck).toBe("unread");
    expect(intel.totals.rivalWonAnswers).toBe(3);
  });

  it("a user override reclassifies a domain and can remove it from opportunities", () => {
    const withOverride = buildSourceIntelligence({
      brand,
      answers,
      corpus,
      overrides: { domainTypes: { "listsite.example": "rival_site" } },
    });
    expect(withOverride.domains.find((d) => d.host === "listsite.example")?.typeRule).toBe("your override");
    expect(withOverride.opportunities.map((o) => o.host)).not.toContain("listsite.example");
    expect(withOverride.overrides).toEqual({ domainTypes: { "listsite.example": "rival_site" } });
  });

  it("per engine summaries and type rollup add up", () => {
    expect(intel.engines.map((e) => e.engine)).toEqual(["chatgpt", "google_ai_overview", "claude", "copilot"]);
    expect(intel.engines.reduce((s, e) => s + e.citations, 0)).toBe(10);
    expect(intel.byType.reduce((s, t) => s + t.citations, 0)).toBe(10);
  });

  it("an empty run is an honest empty result", () => {
    const empty = buildSourceIntelligence({ brand, answers: [] });
    expect(empty.totals).toEqual({ answers: 0, answersWithCitations: 0, citations: 0, domains: 0, rivalWonAnswers: 0 });
    expect(empty.opportunities).toEqual([]);
    expect(empty.voice).toEqual([
      { name: "Acme Monitor", isBrand: true, named: 0, recommended: 0, byEngine: {}, refs: [] },
    ]);
  });

  it("readStoredSources only trusts a schema it knows", () => {
    expect(readStoredSources(intel)).toBe(intel);
    expect(readStoredSources({ ...intel, schema_version: 99 })).toBeNull();
    expect(readStoredSources(null)).toBeNull();
  });
});

describe("on the recorded Kestrel sample run", () => {
  const bundle = JSON.parse(
    readFileSync(path.join(__dirname, "..", "..", "..", "examples", "kestrel", "run.json"), "utf8"),
  );
  const intel = buildSourceIntelligence({
    brand: {
      name: bundle.brand_model.brand,
      domain: bundle.brand_model.domain,
      aliases: bundle.brand_model.aliases,
      competitors: bundle.brand_model.competitors,
    },
    answers: bundle.answers,
    corpus: bundle.corpus_pages,
  });

  it("matches the citation projection's host derivation exactly", () => {
    for (const c of bundle.citations as { url: string; host: string }[]) {
      expect(sourceHost(c.url)).toBe(citationHost(c.url));
    }
  });

  it("every receipt opens an answer in the bundle", () => {
    const keys = new Set((bundle.answers as { qid: string; engine: string }[]).map((a) => `${a.qid}|${a.engine}`));
    for (const o of intel.opportunities) for (const r of o.receipts) expect(keys.has(`${r.qid}|${r.engine}`)).toBe(true);
    for (const v of intel.voice) for (const r of v.refs) expect(keys.has(`${r.qid}|${r.engine}`)).toBe(true);
    for (const d of intel.domains) expect(d.refs.length).toBe(d.answers);
  });

  it("finds the listicles rivals sit on, never a rival's own site", () => {
    expect(intel.totals.citations).toBe(204);
    expect(intel.opportunities.length).toBeGreaterThan(0);
    for (const o of intel.opportunities) expect(["own_site", "rival_site"]).not.toContain(o.type);
    expect(intel.domains.find((d) => d.host === "upcheck.example")?.type).toBe("rival_site");
    // ranked by evidence, descending
    const ev = intel.opportunities.map((o) => o.evidence);
    expect([...ev].sort((a, b) => b - a)).toEqual(ev);
  });
});

describe("pageKey", () => {
  it("drops tracking params, trailing slashes and www", () => {
    expect(pageKey("https://www.a.example/x/?utm_source=g&id=2#frag")).toBe("a.example/x?id=2");
    expect(pageKey("https://web.archive.org/web/2026id_/https://a.example/x")).toBe("a.example/x");
  });
});

describe("buildSourceHistory", () => {
  const run = (date: string, list: SourceAnswerInput[]) => ({
    runId: date,
    date,
    intel: buildSourceIntelligence({ brand, answers: list, corpus }),
  });
  it("aligns per-run counts and counts opportunity persistence", () => {
    const h = buildSourceHistory([run("2026-10-02", answers), run("2026-09-01", answers.slice(0, 2))]);
    expect(h.runs.map((r) => r.date)).toEqual(["2026-09-01", "2026-10-02"]);
    const list = h.domains.find((d) => d.host === "listsite.example")!;
    expect(list.citations).toEqual([2, 3]);
    expect(list.opportunityRuns).toBe(2);
    expect(list.latestEvidence).toBe(2);
    expect(h.voice[0]).toMatchObject({ name: "Acme Monitor", isBrand: true, named: [0, 2] });
    expect(h.voice.find((v) => v.name === "Rivalry")?.named).toEqual([2, 4]);
  });
});
