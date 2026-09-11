// REPORT INTEL — the five data-gold findings, each proven on real stored runs.
// Fixtures copy the shapes of fixtures/run.json (corpus_pages + answers).
import { describe, expect, it } from "vitest";
import {
  bandDescriptor,
  battlefieldRows,
  buriedBehind,
  citationDepth,
  consensusSources,
  degradedEngines,
  engineCount,
  entityConfusion,
  lossMap,
  mergedPricingClaims,
  opportunityPages,
  ownSiteCoverage,
  pageHost,
  pageOwner,
  perceptionClaims,
  pricingClaims,
  pricingFigures,
  rankRiskClaims,
  sendElsewhere,
  shareOfVoiceRows,
  sitePagesMeta,
  sourceMix,
  toneCounts,
  type IntelAnswer,
  type IntelPage,
  type RivalOwnerFn,
} from "./report-intel";

/* A tiny rival-owner matching makeRivalOwner's contract: Atlassian owns any
 * host whose registrable domain contains "atlassian" or "jira". */
const ownerFn: RivalOwnerFn = (host) =>
  /atlassian|jira/.test(host) ? "Jira" : /amplitude|mixpanel/.test(host) ? "Amplitude" : null;

const page = (o: Partial<IntelPage> & Pick<IntelPage, "url" | "cited_by">): IntelPage => ({
  title: o.url,
  page_type: "listicle",
  cited_for_qids: [],
  brand_present: false,
  competitors_present: [],
  opportunity: false,
  ...o,
});

const answer = (o: Partial<IntelAnswer> & Pick<IntelAnswer, "qid" | "engine">): IntelAnswer => ({
  ok: true,
  qtype: "category",
  ...o,
});

describe("primitives", () => {
  it("counts distinct engines and total depth from cited_by", () => {
    expect(engineCount({ claude: 2, gemini: 2, perplexity: 1 })).toBe(3);
    expect(engineCount({ chatgpt: 3 })).toBe(1);
    expect(engineCount({ claude: 0 })).toBe(0);
    expect(citationDepth({ claude: 2, gemini: 2, perplexity: 1 })).toBe(5);
    expect(citationDepth({ chatgpt: 3 })).toBe(3);
  });
  it("reads the effective host and rival owner", () => {
    const p = page({ url: "https://web.example/x", final_url: "https://www.Atlassian.com/jira", cited_by: {} });
    expect(pageHost(p)).toBe("atlassian.com");
    expect(pageOwner(p, ownerFn)).toBe("Jira");
    expect(pageOwner(page({ url: "https://workgrid.example/x", cited_by: {} }), ownerFn)).toBeNull();
  });
});

describe("battlefieldRows — consensus over depth (Task 2) + rival-owned honesty (Task 1)", () => {
  const consensus = page({ url: "https://cpoclub.com/list", cited_by: { claude: 1, gemini: 1, perplexity: 1 }, opportunity: true });
  const deep = page({ url: "https://onehorizon.ai/deep", cited_by: { claude: 7 }, opportunity: true });
  const owned = page({ url: "https://atlassian.com/jira", cited_by: { claude: 3, gemini: 2 }, opportunity: true });
  const present = page({ url: "https://trackflow.example/home", cited_by: { chatgpt: 3 }, brand_present: true });

  it("default sort is by total citations DESC", () => {
    const rows = battlefieldRows([consensus, deep, owned, present], ownerFn, false);
    expect(rows.map((r) => r.total)).toEqual([7, 5, 3, 3]);
  });

  it("opportunities-first ranks the 3-engine page ABOVE the 1-engine depth-7 page", () => {
    const rows = battlefieldRows([deep, consensus, present], ownerFn, true);
    // consensus (3 engines) beats deep (1 engine, depth 7) despite lower depth
    expect(rows[0].page.url).toBe("https://cpoclub.com/list");
    expect(rows[0].engineCount).toBe(3);
    expect(rows[1].page.url).toBe("https://onehorizon.ai/deep");
    expect(rows[0].isOpportunity).toBe(true);
  });

  it("NEVER gives a rival-owned page opportunity priority", () => {
    const rows = battlefieldRows([owned, consensus], ownerFn, true);
    // consensus is a real opportunity; owned is demoted out of the opp block
    expect(rows[0].page.url).toBe("https://cpoclub.com/list");
    const ownedRow = rows.find((r) => r.page.url === "https://atlassian.com/jira")!;
    expect(ownedRow.owner).toBe("Jira");
    expect(ownedRow.isOpportunity).toBe(false);
  });
});

describe("consensusSources (Task 2)", () => {
  it("returns brand-absent, ≥2-engine, non-rival-owned pages sorted by consensus", () => {
    const pages = [
      page({ url: "https://cpoclub.com/a", cited_by: { claude: 2, perplexity: 1 } }), // 2 engines
      page({ url: "https://airtable.com/b", cited_by: { claude: 2, gemini: 1, perplexity: 1 } }), // 3 engines
      page({ url: "https://solo.com/c", cited_by: { claude: 5 } }), // 1 engine — excluded
      page({ url: "https://trackflow.example/d", cited_by: { claude: 2, gemini: 2 }, brand_present: true }), // present — excluded
      page({ url: "https://atlassian.com/jira", cited_by: { claude: 2, gemini: 2 } }), // rival-owned — excluded
    ];
    const cs = consensusSources(pages, ownerFn);
    expect(cs.map((c) => c.page.url)).toEqual(["https://airtable.com/b", "https://cpoclub.com/a"]);
    expect(cs[0].engineCount).toBe(3);
  });
  it("empty when nothing qualifies", () => {
    expect(consensusSources([page({ url: "https://x.com", cited_by: { claude: 9 } })], ownerFn)).toEqual([]);
  });
});

describe("sourceMix (Task 1) — one denominator, stated", () => {
  it("counts every cited page once and flags the rival-owned ones", () => {
    const pages = [
      page({ url: "https://a.com", page_type: "listicle", cited_by: { claude: 1 }, opportunity: true }),
      page({ url: "https://atlassian.com/jira", page_type: "listicle", cited_by: { claude: 1 }, opportunity: true }),
    ];
    // only the winnable listicle counts as missing, not Atlassian's own site
    expect(sourceMix(pages, ownerFn)).toBe("2 pages cited · 2 listicles. You appear on 0 of the 2. 1 of them sits on a rival's own domain.");
  });
  it("says so when the only cited page is a rival's own site", () => {
    const pages = [page({ url: "https://atlassian.com/jira", cited_by: { claude: 1 }, opportunity: true })];
    expect(sourceMix(pages, ownerFn)).toBe("1 page cited · 1 listicle. You appear on 0 of the 1. 1 of them sits on a rival's own domain.");
  });
  it("returns null for an empty corpus", () => {
    expect(sourceMix([], ownerFn)).toBeNull();
  });
});

describe("perceptionClaims + rankRiskClaims (Task 3)", () => {
  const answers: IntelAnswer[] = [
    answer({ qid: "q1", engine: "chatgpt", verdict: { claims: [{ text: "steep learning curve", kind: "risk" }] } }),
    answer({ qid: "q1", engine: "claude", verdict: { claims: [{ text: "Steep learning curve", kind: "risk" }] } }),
    answer({ qid: "q2", engine: "gemini", verdict: { claims: [{ text: "steep learning curve", kind: "risk" }] } }),
    answer({ qid: "q3", engine: "chatgpt", verdict: { claims: [{ text: "pricier than rivals", kind: "risk" }] } }),
    answer({ qid: "q4", engine: "claude", verdict: { claims: [{ text: "fast and clean", kind: "praise" }] } }),
  ];
  it("dedupes by lowercased text, tracks distinct engines and repetition count", () => {
    const claims = perceptionClaims(answers);
    const curve = claims.find((c) => c.text === "steep learning curve")!;
    expect(curve.engines).toEqual(["chatgpt", "claude", "gemini"]);
    expect(curve.count).toBe(3);
    // Each occurrence carries a receipt so praise/risk items can link back
    expect(curve.refs).toEqual([
      { qid: "q1", engine: "chatgpt" },
      { qid: "q1", engine: "claude" },
      { qid: "q2", engine: "gemini" },
    ]);
    expect(claims.find((c) => c.kind === "praise")!.text).toBe("fast and clean");
  });
  it("ranks risk by (engines DESC, count DESC) — the widest-agreed doubt leads", () => {
    const risk = rankRiskClaims(perceptionClaims(answers));
    expect(risk.map((c) => c.text)).toEqual(["steep learning curve", "pricier than rivals"]);
    expect(risk[0].engines.length).toBe(3); // "k of 4 engines" → k = 3
  });
});

describe("buriedBehind (Task 4)", () => {
  it("lists the rivals named ahead of a present-but-buried brand, excluding self", () => {
    const answers: IntelAnswer[] = [
      answer({
        qid: "q05",
        engine: "chatgpt",
        verdict: {
          brand_present: true,
          prominence: "buried",
          other_brands: [{ name: "Jira", why: "" }, { name: "Asana", why: "" }, { name: "Trackflow", why: "" }],
        },
      }),
      answer({ qid: "q06", engine: "claude", verdict: { brand_present: true, prominence: "first", other_brands: [{ name: "Jira" }] } }),
    ];
    const b = buriedBehind(answers, "Trackflow", ["trackflow.example"]);
    expect(b).toHaveLength(1);
    expect(b[0].qid).toBe("q05");
    expect(b[0].rivals).toEqual(["Jira", "Asana"]); // self "Trackflow" dropped
    expect(b[0].answer.engine).toBe("chatgpt"); // carries the row for openAnswer
  });
  it("empty when buried answers name no rivals (view falls back to plain tally)", () => {
    const answers: IntelAnswer[] = [answer({ qid: "q1", engine: "gemini", verdict: { prominence: "buried", other_brands: [] } })];
    expect(buriedBehind(answers, "Trackflow")).toEqual([]);
  });
});

describe("lossMap (Task 5)", () => {
  const answers: IntelAnswer[] = [
    // q01: brand never recommended → losing
    answer({ qid: "q01", engine: "chatgpt", question: "Best product dev platform?", verdict: { mention_type: "absent" } }),
    answer({ qid: "q01", engine: "claude", question: "Best product dev platform?", verdict: { mention_type: "listed" } }),
    // q02: brand recommended → a win, excluded
    answer({ qid: "q02", engine: "gemini", question: "Best issue tracker?", verdict: { mention_type: "recommended" } }),
  ];
  const pages = [
    page({ url: "https://cpoclub.com/list", cited_by: { claude: 2, perplexity: 1 }, cited_for_qids: ["q01"], competitors_present: ["Jira"] }),
    page({ url: "https://airtable.com/x", cited_by: { claude: 2, gemini: 1, perplexity: 1 }, cited_for_qids: ["q01"], competitors_present: ["Jira", "Asana"] }),
    page({ url: "https://atlassian.com/jira", cited_by: { claude: 9 }, cited_for_qids: ["q01"], competitors_present: ["Jira"] }), // rival-owned — excluded
    page({ url: "https://won.com/y", cited_by: { gemini: 3 }, cited_for_qids: ["q02"] }),
  ];
  it("picks the consensus page beating the brand per losing question, excluding rival-owned & won questions", () => {
    const { rows, more } = lossMap(answers, pages, ownerFn);
    expect(rows).toHaveLength(1);
    expect(rows[0].qid).toBe("q01");
    expect(rows[0].page.url).toBe("https://airtable.com/x"); // 3 engines beats atlassian's depth-9
    expect(rows[0].engineCount).toBe(3);
    expect(rows[0].competitors).toEqual(["Jira", "Asana"]);
    expect(more).toBe(0);
  });
  it("caps rows and reports the honest remainder", () => {
    const many: IntelAnswer[] = [];
    const manyPages: IntelPage[] = [];
    for (let i = 0; i < 10; i++) {
      const qid = `l${i}`;
      many.push(answer({ qid, engine: "chatgpt", question: `q ${i}`, verdict: { mention_type: "absent" } }));
      manyPages.push(page({ url: `https://p${i}.com`, cited_by: { claude: 1 }, cited_for_qids: [qid], competitors_present: ["Jira"] }));
    }
    const { rows, more } = lossMap(many, manyPages, ownerFn, 8);
    expect(rows).toHaveLength(8);
    expect(more).toBe(2);
  });
  it("empty state when there are no losing questions with a cited page", () => {
    expect(lossMap([answer({ qid: "q02", engine: "gemini", verdict: { mention_type: "recommended" } })], pages, ownerFn).rows).toEqual([]);
  });
});

describe("sendElsewhere (Item 1) — conditional steers", () => {
  it("groups steers by rival winner, collects the brand's own segments, carries receipts", () => {
    const answers: IntelAnswer[] = [
      answer({
        qid: "q01",
        engine: "chatgpt",
        verdict: {
          segments: [
            { segment: "enterprise teams", winner: "Jira", reason: "deeper admin controls" },
            { segment: "solo founders", winner: "Trackflow", reason: "you are the default here" },
          ],
        },
      }),
      answer({
        qid: "q02",
        engine: "claude",
        verdict: { segments: [{ segment: "regulated industries", winner: "Jira", reason: "compliance certs" }] },
      }),
    ];
    const r = sendElsewhere(answers, "Trackflow", ["trackflow.example"])!;
    expect(r.steers[0].winner).toBe("Jira"); // 2 distinct segments — kept
    expect(r.steers[0].count).toBe(2);
    expect(r.steers[0].items[0]).toMatchObject({ segment: "enterprise teams", qid: "q01", engine: "chatgpt" });
    expect(r.ownSegments).toEqual([{ phrase: "solo founders", count: 1 }]); // self dropped from steers
    expect(r.singleSteerRivals).toBe(0);
  });
  it("returns null when no answer carried a segments field (old runs → panel absent)", () => {
    expect(sendElsewhere([answer({ qid: "q1", engine: "gemini", verdict: { mention_type: "listed" } })], "Trackflow")).toBeNull();
  });
  it("returns a non-null empty shape when the field is present but empty", () => {
    const r = sendElsewhere([answer({ qid: "q1", engine: "gemini", verdict: { segments: [] } })], "Trackflow");
    expect(r).not.toBeNull();
    expect(r!.steers).toEqual([]);
    expect(r!.ownSegments).toEqual([]);
    expect(r!.singleSteerRivals).toBe(0);
  });

  // Self-variants + "not {brand}" must never appear as steer winners.
  it("classifies self-variants + drops 'not {brand}' — none become steers", () => {
    const answers: IntelAnswer[] = [
      answer({
        qid: "q01",
        engine: "chatgpt",
        verdict: {
          segments: [
            { segment: "SMB payroll", winner: "Fintly Business" },
            { segment: "freelancers abroad", winner: "Fintly for Business" },
            { segment: "personal accounts", winner: "Fintly (individuals)" },
            { segment: "value seekers", winner: "Fintly — **Best Overall**" },
            { segment: "risk-averse", winner: "not Fintly" },
            { segment: "high-volume FX", winner: "Nubridge", reason: "higher limits" },
            { segment: "crypto holders", winner: "Nubridge", reason: "native crypto" },
          ],
        },
      }),
    ];
    const r = sendElsewhere(answers, "Fintly")!;
    // only Nubridge (a genuine rival with 2 segments) is a steer
    expect(r.steers.map((s) => s.winner)).toEqual(["Nubridge"]);
    // the four self-variant winners fold into the "default for" line
    expect(r.ownSegments.map((o) => o.phrase).sort()).toEqual([
      "SMB payroll",
      "freelancers abroad",
      "personal accounts",
      "value seekers",
    ]);
    // "not Fintly" is a negation artifact — dropped entirely, not an own segment
    expect(r.ownSegments.some((o) => o.phrase === "risk-averse")).toBe(false);
    expect(r.singleSteerRivals).toBe(0);
  });

  // ~25 one-segment winner blocks collapse into a single tail count.
  it("keeps ≥2-segment winners (max 8) and collapses one-segment rivals into a tail", () => {
    const segs: { segment: string; winner: string }[] = [
      { segment: "enterprise A", winner: "Jira" },
      { segment: "enterprise B", winner: "Jira" }, // Jira = 2 distinct → kept
    ];
    for (let i = 0; i < 20; i++) segs.push({ segment: `seg ${i}`, winner: `Rival${i}` }); // 20 singletons
    const r = sendElsewhere([answer({ qid: "q1", engine: "chatgpt", verdict: { segments: segs } })], "Fintly")!;
    expect(r.steers).toHaveLength(1);
    expect(r.steers[0].winner).toBe("Jira");
    expect(r.steers[0].count).toBe(2);
    expect(r.singleSteerRivals).toBe(20);
  });

  // DOMINANT-SCALE: a full run mines dozens of near-duplicate,
  // markdown-bearing segment strings — the panel must NOT render a raw wall.
  it("dedupes markdown/casing across many answers into frequency-ranked phrases", () => {
    const answers: IntelAnswer[] = [];
    // 9 answers each making Fintly the default for "everyday personal transfers"
    // (mixed casing + markdown), plus a Nubridge steer with 2 distinct segments.
    for (let i = 0; i < 9; i++) {
      answers.push(
        answer({
          qid: `q${i}`,
          engine: ["chatgpt", "claude", "gemini", "perplexity"][i % 4],
          verdict: {
            segments: [
              { segment: i % 2 ? "**Everyday personal transfers**" : "everyday personal transfers", winner: "Fintly" },
              { segment: i % 2 ? "large business transfers" : "high-volume FX", winner: "Nubridge", reason: "**higher** limits" },
            ],
          },
        }),
      );
    }
    const r = sendElsewhere(answers, "Fintly")!;
    // 9 raw own-segments collapse to ONE deduped, md-stripped phrase with count 9
    expect(r.ownSegments).toEqual([{ phrase: "everyday personal transfers", count: 9 }]);
    // Nubridge has 2 distinct segments → a kept steer; reason markdown-stripped
    expect(r.steers).toHaveLength(1);
    expect(r.steers[0].winner).toBe("Nubridge");
    expect(r.steers[0].count).toBe(2);
    expect(r.steers[0].items[0].reason).toBe("higher limits");
  });
});

describe("pricingFigures — distinct fee FIGURES", () => {
  const claim = (text: string): import("./report-intel").MergedPricingClaim => ({
    text,
    engines: ["chatgpt"],
    refs: [{ qid: "q1", engine: "chatgpt" }],
    count: 1,
    confused: false,
  });
  it("extracts percent ranges, single percents and currency amounts, deduped", () => {
    const figs = pricingFigures([
      claim("fees run 0.33–0.6% on most routes"),
      claim("a flat 0.35% conversion fee"),
      claim("0.43% and 0.57% on exotic pairs"),
      claim("a fixed $31 fee over $25,000 transfers"),
      claim("still 0.35% — same as above"), // dup 0.35% folds away
    ]);
    expect(figs).toEqual(["0.33–0.6%", "0.35%", "0.43%", "0.57%", "$31", "$25,000"]);
  });
  it("normalizes a hyphen range to an en-dash and dedupes against it", () => {
    const figs = pricingFigures([claim("0.33-0.6% here"), claim("and 0.33–0.6% there")]);
    expect(figs).toEqual(["0.33–0.6%"]);
  });
  it("returns [] when no numeric figure appears (qualitative fallback)", () => {
    expect(pricingFigures([claim("transparent fees, no hidden costs")])).toEqual([]);
    expect(pricingFigures([])).toEqual([]);
  });
});

describe("mergedPricingClaims — DISTINCT fee claims", () => {
  it("folds markdown/casing dups AND substrings into the distinct count, unioning engines", () => {
    const answers: IntelAnswer[] = [
      // exact dup across 3 engines: markdown-bold + trailing period vs plain
      answer({ qid: "q1", engine: "chatgpt", verdict: { pricing_claims: ["**Cash pickup, home delivery available.**"] } }),
      answer({ qid: "q2", engine: "claude", verdict: { pricing_claims: ["Cash pickup, home delivery available"] } }),
      answer({ qid: "q3", engine: "gemini", verdict: { pricing_claims: ["cash pickup, home delivery available"] } }),
      // substring pair: the short claim folds into the longer 0.35% sentence
      answer({ qid: "q4", engine: "chatgpt", verdict: { pricing_claims: ["all transfers use the mid-market rate"] } }),
      answer({ qid: "q5", engine: "claude", verdict: { pricing_claims: ["all transfers use the mid-market rate, with a 0.35% fee"] } }),
      // a standalone qualitative claim
      answer({ qid: "q6", engine: "perplexity", verdict: { pricing_claims: ["transparent fees, no hidden costs"] } }),
    ];
    const merged = mergedPricingClaims(answers);
    // 6 raw claims collapse to 3 distinct merged claims
    expect(merged).toHaveLength(3);
    // cash-pickup group: 3 engines unioned, markdown stripped from the display text
    const cash = merged.find((c) => /cash pickup/i.test(c.text))!;
    expect(cash.text).not.toMatch(/\*\*/);
    expect([...cash.engines].sort()).toEqual(["chatgpt", "claude", "gemini"]);
    expect(cash.count).toBe(3);
    // mid-market: exactly one merged claim, and it is the LONGER 0.35% sentence
    const mid = merged.filter((c) => /mid-market rate/i.test(c.text));
    expect(mid).toHaveLength(1);
    expect(mid[0].text).toContain("0.35%");
    expect([...mid[0].engines].sort()).toEqual(["chatgpt", "claude"]);
  });
  it("empty when no pricing claims", () => {
    expect(mergedPricingClaims([answer({ qid: "q1", engine: "chatgpt", verdict: { mention_type: "listed" } })])).toEqual([]);
  });
});

describe("shareOfVoiceRows — brand merged at true rank, scale can't overflow", () => {
  it("merges the brand row at its TRUE rank and scales bars over EVERYTHING (brand>rival)", () => {
    // Fintly: brand 85 mentions, top rival 57 — the brand must lead, and its bar
    // must scale to 85 (not the 57 rival max that produced a 149%-wide bar).
    const entries: [string, number][] = [
      ["Nubridge", 57],
      ["Paylora", 40],
      ["Monzo", 5],
      ["OneOff", 1],
    ];
    const { rows, scaleMax, singles } = shareOfVoiceRows(entries, "Fintly", 85);
    expect(rows[0]).toEqual({ name: "Fintly", count: 85, isBrand: true }); // brand leads
    expect(rows.map((r) => r.count)).toEqual([85, 57, 40, 5]); // sorted DESC incl. brand
    expect(scaleMax).toBe(85); // scale spans the brand, so 85/85 = 100% (no overflow)
    expect(singles).toBe(1); // OneOff (mentioned once) rolls into the "+N more once" line
  });
  it("still merges the brand when the judges never listed it (computed tally, zero ok)", () => {
    const entries: [string, number][] = [["Nubridge", 4]];
    const { rows, scaleMax } = shareOfVoiceRows(entries, "Fintly", 0);
    const brand = rows.find((r) => r.isBrand)!;
    expect(brand).toEqual({ name: "Fintly", count: 0, isBrand: true });
    expect(scaleMax).toBe(4); // brandCount 0 never drops scaleMax below the rival max
  });
});

describe("pricingClaims (Item 2)", () => {
  it("dedupes by normalized text, tracks engines + receipts + repetition, sorts by consensus", () => {
    const answers: IntelAnswer[] = [
      answer({ qid: "q1", engine: "chatgpt", verdict: { pricing_claims: ["Starts at $10/user/mo."] } }),
      answer({ qid: "q2", engine: "claude", verdict: { pricing_claims: ["starts at $10/user/mo"] } }),
      answer({ qid: "q3", engine: "gemini", verdict: { pricing_claims: ["Free tier available"] } }),
    ];
    const claims = pricingClaims(answers);
    expect(claims[0].text).toBe("Starts at $10/user/mo."); // 2 engines leads
    expect(claims[0].engines).toEqual(["chatgpt", "claude"]);
    expect(claims[0].count).toBe(2);
    expect(claims[0].refs).toEqual([{ qid: "q1", engine: "chatgpt" }, { qid: "q2", engine: "claude" }]);
    expect(claims[1].text).toBe("Free tier available");
  });
  it("empty when no pricing claims", () => {
    expect(pricingClaims([answer({ qid: "q1", engine: "chatgpt", verdict: { mention_type: "listed" } })])).toEqual([]);
  });
});

describe("entityConfusion (Item 7)", () => {
  it("groups entity_confusion answers by engine with receipts", () => {
    const answers: IntelAnswer[] = [
      answer({ qid: "q1", engine: "gemini", verdict: { entity_confusion: true } }),
      answer({ qid: "q2", engine: "gemini", verdict: { entity_confusion: true } }),
      answer({ qid: "q3", engine: "chatgpt", verdict: { entity_confusion: false } }),
    ];
    const ec = entityConfusion(answers);
    expect(ec).toHaveLength(1);
    expect(ec[0]).toMatchObject({ engine: "gemini", count: 2 });
    expect(ec[0].refs).toEqual([{ qid: "q1", engine: "gemini" }, { qid: "q2", engine: "gemini" }]);
  });
  it("empty when no confusion flagged", () => {
    expect(entityConfusion([answer({ qid: "q1", engine: "chatgpt", verdict: {} })])).toEqual([]);
  });
});

describe("bandDescriptor (Item 3)", () => {
  it("classifies range vs stable point vs none", () => {
    expect(bandDescriptor({ min: 2, max: 5 })).toEqual({ kind: "range", min: 2, max: 5 });
    expect(bandDescriptor({ min: 4, max: 4 })).toEqual({ kind: "point", min: 4, max: 4 });
    expect(bandDescriptor(null)).toEqual({ kind: "none", min: 0, max: 0 });
    expect(bandDescriptor(undefined)).toEqual({ kind: "none", min: 0, max: 0 });
  });
});

describe("degradedEngines (Item 4)", () => {
  it("flags engines under half their expected answers", () => {
    const health = {
      answers: {
        chatgpt: { got: 20, expected: 20 },
        gemini: { got: 6, expected: 20 }, // 6 < 10 → degraded
        perplexity: { got: 12, expected: 20 }, // 12 ≥ 10 → ok
        claude: { got: 0, expected: 20 }, // dead → degraded
      },
    };
    expect(degradedEngines(health)).toEqual([
      { engine: "claude", got: 0, expected: 20 },
      { engine: "gemini", got: 6, expected: 20 },
    ]);
  });
  it("empty for a healthy run and for a missing health blob", () => {
    expect(degradedEngines({ answers: { chatgpt: { got: 20, expected: 20 } } })).toEqual([]);
    expect(degradedEngines(null)).toEqual([]);
    expect(degradedEngines(undefined)).toEqual([]);
  });
});

describe("sitePagesMeta (Item 5 write shape)", () => {
  it("keeps only url/title/date, dedupes by url, caps, never carries text", () => {
    const crawled = [
      { url: "https://acme.com/", title: " Home ", text: "long body", date: "2026-01-01T00:00:00.000Z" },
      { url: "https://acme.com/", title: "dup", text: "x" }, // duplicate url dropped
      { url: "https://acme.com/pricing", title: "Pricing", text: "y" }, // no date
    ];
    const meta = sitePagesMeta(crawled, 25);
    expect(meta).toEqual([
      { url: "https://acme.com/", title: "Home", date: "2026-01-01T00:00:00.000Z" },
      { url: "https://acme.com/pricing", title: "Pricing" },
    ]);
    expect((meta[0] as unknown as Record<string, unknown>).text).toBeUndefined();
  });
  it("respects the cap", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ url: `https://acme.com/${i}`, title: `p${i}` }));
    expect(sitePagesMeta(many, 25)).toHaveLength(25);
  });
});

describe("ownSiteCoverage (Item 5)", () => {
  const sitePages = [
    { url: "https://acme.com/", title: "Home" },
    { url: "https://acme.com/pricing", title: "Pricing", date: "2026-02-01T00:00:00.000Z" },
  ];
  const answers: IntelAnswer[] = [
    answer({ qid: "q01", engine: "chatgpt", question: "best widget?", qtype: "category" }),
    answer({ qid: "q02", engine: "claude", question: "widget vs rival?", qtype: "comparison" }),
    answer({ qid: "q03", engine: "gemini", question: "how to solve X?", qtype: "problem" }),
  ];
  const corpus = [
    page({ url: "https://acme.com/pricing", cited_by: { chatgpt: 1 }, cited_for_qids: ["q01"], brand_present: true }), // own page cited for q01
    page({ url: "https://rival.com/list", cited_by: { claude: 2 }, cited_for_qids: ["q02", "q03"] }),
  ];
  it("marks a question covered only when the brand's own domain is cited for it", () => {
    const cov = ownSiteCoverage(sitePages, corpus, answers, "acme.com")!;
    expect(cov.totalQuestions).toBe(3);
    expect(cov.coveredCount).toBe(1); // only q01 has an acme.com page cited
    expect(cov.gaps.map((g) => g.qid)).toEqual(["q02", "q03"]);
    expect(cov.pages).toHaveLength(2);
  });
  it("returns null when the site_pages snapshot is absent (old runs)", () => {
    expect(ownSiteCoverage(null, corpus, answers, "acme.com")).toBeNull();
    expect(ownSiteCoverage([], corpus, answers, "acme.com")).toBeNull();
  });
});

// ONE opportunity-page definition. The verdict strip read `p.opportunity` and
// the consensus card derived absence from brand_present: adjacent cards said
// "0 opportunity pages" and "8 pages you're absent from" about the same idea.
describe("opportunityPages", () => {
  const cited = (url: string, engines: number, present: boolean | null = false, opportunity = false) =>
    page({
      url,
      opportunity,
      brand_present: present,
      cited_by: Object.fromEntries(["chatgpt", "claude", "gemini"].slice(0, engines).map((e) => [e, 1])),
    });

  it("uses the stored flag when the bundle populates it", () => {
    const pages = [cited("https://a.com", 3, false, true), cited("https://b.com", 3)];
    expect(opportunityPages(pages, ownerFn).map((p) => p.url)).toEqual(["https://a.com"]);
  });

  it("derives absent + cited by 2+ engines when the flag is unpopulated", () => {
    const pages = [
      cited("https://a.com", 3),
      cited("https://b.com", 2),
      cited("https://c.com", 1), // one engine only
      cited("https://d.com", 3, true), // already present
      cited("https://atlassian.com/x", 3), // a rival's own site
    ];
    expect(opportunityPages(pages, ownerFn).map((p) => p.url)).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  it("matches the consensus card exactly, so both cards show one number", () => {
    const pages = [cited("https://a.com", 3), cited("https://b.com", 2), cited("https://c.com", 1)];
    expect(opportunityPages(pages, ownerFn).length).toBe(consensusSources(pages, ownerFn).length);
  });

  it("never counts a rival-owned page, even when the flag says so", () => {
    const pages = [cited("https://atlassian.com/x", 3, false, true)];
    expect(opportunityPages(pages, ownerFn)).toEqual([]);
  });
});

// ONE tone tally. The dossier counted the answers that MENTION the brand (6)
// and the Markdown counted every answer that came back (18).
describe("toneCounts", () => {
  const ans = (o: Partial<IntelAnswer> & { verdict?: Record<string, unknown> }): IntelAnswer => ({
    qid: "q01",
    engine: "chatgpt",
    ok: true,
    ...o,
  }) as IntelAnswer;

  const answers: IntelAnswer[] = [
    ans({ verdict: { brand_present: true, sentiment: "positive" } }),
    ans({ verdict: { brand_present: true, sentiment: "positive" } }),
    ans({ verdict: { brand_present: true, sentiment: "neutral", entity_confusion: true } }),
    ans({ verdict: { brand_present: true, sentiment: "negative" } }),
    ans({ verdict: { brand_present: false, sentiment: "negative" } }), // not a mention
    ans({ ok: false }), // the call returned nothing
  ];

  it("counts sentiment over the answers that mention the brand, and says so", () => {
    const t = toneCounts(answers, "Kestrel");
    expect(t.mentioned).toBe(4);
    expect([t.positive, t.neutral, t.negative]).toEqual([2, 1, 1]);
    expect(t.label).toBe("Tone in the 4 answers that name you, across every question type");
    expect(t.rows).toEqual([
      { gloss: "positive", n: 2 },
      { gloss: "neutral", n: 1 },
      { gloss: "negative", n: 1 },
    ]);
  });

  it("flags how many of those answers are about a different company", () => {
    const t = toneCounts(answers, "Kestrel");
    expect(t.confused).toBe(1);
    expect(t.confusionNote).toContain("1 of those 4 are about a different company");
    expect(t.confusionNote).toContain("Kestrel");
  });

  it("has no confusion note when the judge flagged none", () => {
    expect(toneCounts([ans({ verdict: { brand_present: true, sentiment: "positive" } })]).confusionNote).toBeNull();
  });

  it("is empty and honest on a run with no mentions", () => {
    const t = toneCounts([ans({ verdict: { brand_present: false } })]);
    expect(t.mentioned).toBe(0);
    expect(t.rows).toEqual([]);
    expect(t.label).toBe("Tone in the 0 answers that name you, across every question type");
  });
});

// A claim mined ONLY from entity-confused answers belongs to the entity-clarity
// finding, not to "what they praise" / "what the engines say you cost".
describe("claims carry the entity-confusion flag", () => {
  const a = (o: Partial<IntelAnswer> & { verdict?: Record<string, unknown> }): IntelAnswer =>
    ({ qid: "q01", engine: "chatgpt", ok: true, ...o }) as IntelAnswer;

  it("marks a claim whose every source answer was confused", () => {
    const claims = perceptionClaims([
      a({ verdict: { entity_confusion: true, claims: [{ text: "a web server for ASP.NET", kind: "praise" }] } }),
      a({ engine: "claude", verdict: { claims: [{ text: "great alerting", kind: "praise" }] } }),
    ]);
    expect(claims.find((c) => c.text.includes("ASP.NET"))?.confused).toBe(true);
    expect(claims.find((c) => c.text.includes("alerting"))?.confused).toBe(false);
  });

  it("clears the flag as soon as one clean answer repeats the claim", () => {
    const claims = perceptionClaims([
      a({ verdict: { entity_confusion: true, claims: [{ text: "same claim", kind: "risk" }] } }),
      a({ engine: "claude", verdict: { claims: [{ text: "same claim", kind: "risk" }] } }),
    ]);
    expect(claims[0].confused).toBe(false);
  });

  it("carries the flag through the merged pricing claims", () => {
    const merged = mergedPricingClaims([
      a({ verdict: { entity_confusion: true, pricing_claims: ["$99 a month"] } }),
    ]);
    expect(merged[0].confused).toBe(true);
  });
});
