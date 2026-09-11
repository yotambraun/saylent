// STANDING PREVIEW INVARIANTS — the $0 CI probe that makes the "markdown +
// mid-word cut" bug class IMPOSSIBLE, not patched (architectural doctrine). Every
// display/preview string in the report flows through the ONE pipeline in
// strip-md.ts. This test does NOT enumerate fields by hand (that is how the class
// kept regrowing); it walks the ENTIRE output object graph of the preview
// composers generically and asserts the guarantees the pipeline actually makes.
//
// Run over BOTH the REAL Kestrel Uptime smoke capture (fixtures/run.json — a
// real audit of our own hosted fictional brand, rival names pseudonymized —
// the challenger path) AND a synthetic
// dominant input deliberately RIDDLED with markdown and mid-word truncation
// (the path no fixture exercises). If any composer ever emits a string that
// skipped the pipeline, one of these assertions fails.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildBrief, type BriefInput } from "./brief";
import { buildRivalCompare, type CompareInput } from "./compare";
import {
  mergedPricingClaims,
  perceptionClaims,
  sendElsewhere,
  shareOfVoiceRows,
  type IntelAnswer,
} from "./report-intel";
import { rivalGaps } from "./rival-gaps";
import { previewText } from "./strip-md";

/* ============================ generic string walker ======================= */
// O(total output size), no per-shape knowledge: collect every string reachable
// in an arbitrary JSON-like value. A new composer field is covered automatically.
function walkStrings(v: unknown, out: string[]): void {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) walkStrings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) walkStrings(x, out);
}
function stringsOf(v: unknown): string[] {
  const out: string[] = [];
  walkStrings(v, out);
  return out;
}

/* ---- the invariants a CLEANED preview string must hold (pipeline guarantees) --- */
// previewText nukes ALL asterisks (paired, orphan, mid-word-cut residue), strips
// [n] citation brackets, collapses whitespace, and trims. Those are total, so a
// cleaned preview surface must satisfy every one of these.
function assertCleanPreview(label: string, strings: string[]): void {
  for (const s of strings) {
    expect(/\*/.test(s), `${label}: no asterisk/markdown residue in ${JSON.stringify(s)}`).toBe(
      false,
    );
    expect(
      /\[\d+\]/.test(s),
      `${label}: no [n] citation bracket in ${JSON.stringify(s)}`,
    ).toBe(false);
    expect(s === s.trim(), `${label}: no leading/trailing whitespace in ${JSON.stringify(s)}`).toBe(
      true,
    );
    expect(/\s{2,}/.test(s), `${label}: no doubled whitespace in ${JSON.stringify(s)}`).toBe(false);
    // an upstream ASCII "..." cut is always normalized to the "…" glyph by the
    // tail-tidy; a preview must never surface a raw trailing "..." fragment.
    expect(/\.\.\.$/.test(s), `${label}: no raw ASCII '...' tail in ${JSON.stringify(s)}`).toBe(
      false,
    );
  }
}

/* ---- the completeness contract for a RAW derivation the composers clean ---- */
// perception / rival-gaps / share-of-voice keep verbatim text (the dossier renders
// them through the inline-markdown segment parser; the Brief cleans them at
// emission). The standing guarantee here is that the ONE pipeline FULLY cleans
// whatever they emit — proven against real issue-tracker data + the riddled input, so no
// exotic engine markdown escapes the stripper.
function assertPipelineCleans(label: string, strings: string[]): void {
  for (const s of strings) {
    const cleaned = previewText(s);
    expect(/\*/.test(cleaned), `${label}: pipeline leaves asterisk in ${JSON.stringify(s)}`).toBe(
      false,
    );
    expect(
      /\[\d+\]/.test(cleaned),
      `${label}: pipeline leaves [n] citation in ${JSON.stringify(s)}`,
    ).toBe(false);
    expect(cleaned === cleaned.trim(), `${label}: pipeline leaves stray whitespace`).toBe(true);
  }
}

/* ============================== the two inputs ============================= */

/* 1) the REAL Kestrel Uptime smoke capture (challenger / thin path). */
interface Fixture {
  run: { kind: string; scores: unknown; health?: unknown; site_pages?: unknown; brand_model?: { value_props?: unknown } };
  brand: { name: string; domain: string; aliases: string[]; competitors: string[] };
  answers: unknown[];
  corpus_pages: unknown[];
  domain_checks: unknown[];
  fixes: unknown[];
}
const fixture = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "fixtures/run.json"), "utf8"),
) as Fixture;

function fixtureBriefInput(): BriefInput {
  const vp = fixture.run.brand_model?.value_props;
  return {
    brand: fixture.brand,
    scores: fixture.run.scores as BriefInput["scores"],
    answers: fixture.answers as BriefInput["answers"],
    corpus: fixture.corpus_pages as BriefInput["corpus"],
    checks: fixture.domain_checks as BriefInput["checks"],
    fixes: fixture.fixes as BriefInput["fixes"],
    health: (fixture.run.health ?? null) as BriefInput["health"],
    sitePages: (fixture.run.site_pages ?? null) as BriefInput["sitePages"],
    valueProps: Array.isArray(vp) ? (vp as string[]) : [],
    kind: fixture.run.kind,
  };
}

/* 2) a synthetic DOMINANT input riddled with markdown AND mid-word truncation in
 *    EVERY text-bearing engine field: segments, reasons, winners, pricing claims,
 *    praise/risk claims, rival names + whys, value props, page titles, SOV keys,
 *    and orphan ** / [n] left by an upstream cut. If the pipeline is complete,
 *    every derived preview still comes out clean. */
function riddledBriefInput(): BriefInput {
  const md = (base: string, tail: string) => `**${base}**${tail}`;
  return {
    brand: { name: "Kestrel", domain: "kestrel.example", aliases: ["Kestrel"], competitors: ["Northwind", "Circuit"] },
    scores: {
      overall: { answered: 48, recommended: 45, mentioned: 47, rec_rate: 0.9375, mention_rate: 0.979 },
      per_engine: {
        chatgpt: { answered: 12, recommended: 12, mentioned: 12, rec_rate: 1, mention_rate: 1 },
        claude: { answered: 12, recommended: 11, mentioned: 12, rec_rate: 0.92, mention_rate: 1 },
        gemini: { answered: 12, recommended: 11, mentioned: 12, rec_rate: 0.92, mention_rate: 1 },
        perplexity: { answered: 12, recommended: 11, mentioned: 11, rec_rate: 0.92, mention_rate: 0.92 },
      },
      // SOV keys carry markdown + a cut fragment — the composer must clean them
      share_of_voice: { Kestrel: 40, "**Northwind**": 12, "Circuit [2]": 8 },
      recommended_band: { overall: { min: 44, max: 46 } },
    },
    answers: [
      {
        qid: "q01", qtype: "category", engine: "chatgpt", question: "best way to send money abroad?", ok: true,
        verdict: {
          brand_present: true, mention_type: "recommended", prominence: "first",
          // pricing: markdown-bold + a mid-word ASCII cut ("...comple")
          pricing_claims: ["**Cash pickup, home delivery available.**", "fees run 0.33–0.6% on most routes but the fine print is comple..."],
          claims: [{ text: "great **exchange rates**[1]", kind: "praise" }, { text: "occasional **higher fees on large transf", kind: "risk" }],
          segments: [{ segment: "**large transfers**", winner: "**Northwind**", reason: "higher limits and the onboarding is much sim…" }],
        },
      },
      {
        qid: "q02", qtype: "category", engine: "claude", question: "cheapest transfer service?", ok: true,
        verdict: {
          brand_present: true, mention_type: "recommended", prominence: "buried",
          pricing_claims: ["Cash pickup, home delivery available", "all transfers use the mid-market rate, with a 0.35% fee[3]"],
          claims: [{ text: "clean mobile app", kind: "praise" }],
          segments: [{ segment: "crypto holders", winner: "Northwind", reason: "native crypto trading, which Kestrel does not offer at..." }],
        },
      },
      {
        qid: "q03", qtype: "category", engine: "gemini", question: "kestrel vs northwind?", ok: true,
        verdict: { brand_present: true, mention_type: "recommended", pricing_claims: ["cash pickup, home delivery available"], claims: [{ text: md("clean mobile app", " with great...") , kind: "praise" }] },
      },
      { qid: "q04", qtype: "comparison", engine: "chatgpt", question: "kestrel or circuit for business?", ok: true, verdict: { brand_present: true, mention_type: "recommended", pricing_claims: ["all transfers use the mid-market rate"], claims: [{ text: "**high fees on large amounts**", kind: "risk" }] } },
      { qid: "q05", qtype: "comparison", engine: "claude", question: "lowest fee provider?", ok: true, verdict: { brand_present: true, mention_type: "recommended", pricing_claims: ["a flat 0.35% conversion fee"] } },
      { qid: "q06", qtype: "comparison", engine: "perplexity", question: "hidden costs?", ok: true, verdict: { brand_present: true, mention_type: "recommended", pricing_claims: ["transparent fees, no hidden costs"] } },
      // absent answers → rivals + attributed whys (markdown + cut inside)
      { qid: "q10", qtype: "problem", engine: "chatgpt", question: "send $50k abroad safely?", ok: true, verdict: { brand_present: false, mention_type: "absent", other_brands: [{ name: "**Northwind**", why: "lower fees on large transfers and a higher daily lim…" }] } },
      { qid: "q11", qtype: "problem", engine: "claude", question: "best for freelancers?", ok: true, verdict: { brand_present: false, mention_type: "absent", other_brands: [{ name: "Northwind", why: "lower fees on large transfers[2]" }] } },
      { qid: "q12", qtype: "problem", engine: "gemini", question: "merchant payouts?", ok: true, verdict: { brand_present: false, mention_type: "absent", other_brands: [{ name: "Circuit", why: "**wider** merchant acceptance and checkout cover..." }] } },
    ] as BriefInput["answers"],
    corpus: [
      { url: "https://nerdwallet.com/kestrel-review", final_url: "https://nerdwallet.com/kestrel-review", title: "**Kestrel** review: is it the cheapest? [2024]", page_type: "review", cited_by: { chatgpt: 3, claude: 2 }, brand_present: false, opportunity: true, competitors_present: ["**Northwind**", "Circuit"], cited_for_qids: ["q01", "q04"] },
      { url: "https://example.com/very/deep/path/that-is-quite-long-for-a-host-column-and-then-some", final_url: null, title: "**raw** title with a trailing cut mid-wor", page_type: "other", cited_by: { gemini: 1 }, brand_present: false, opportunity: true, competitors_present: [], cited_for_qids: ["q02"] },
    ] as BriefInput["corpus"],
    checks: [
      { check_name: "live fetch as GPTBot", status: "fail", detail: "blocked with **403** at the edge, no retry succeeded even after..." },
      { check_name: "robots: allow /", status: "pass", detail: "allowed" },
    ],
    fixes: [
      { fix_key: "add-comparison-page", title: "**Publish** a Kestrel vs Northwind comparison page", weight: 9, engines: ["chatgpt", "claude"], effort: "medium", time_to_impact: "2-4 weeks", artifact: "draft ready" },
      { fix_key: "pricing-clarity", title: "Clarify the 0.35% fee on your pricing page", weight: 7, engines: ["gemini"], effort: "low", time_to_impact: "1 week", artifact: null },
    ] as BriefInput["fixes"],
    valueProps: ["**fast** transfers", "mid-market rate", "multi-currency account with a debit card and a lot of other very long...", "business tools"],
  };
}

/* CompareInput / IntelAnswer[] are structural subsets of a BriefInput's rows. */
function compareOf(b: BriefInput): CompareInput {
  return { brand: b.brand, scores: b.scores as CompareInput["scores"], answers: b.answers as CompareInput["answers"], corpus: b.corpus as CompareInput["corpus"] };
}
const answersOf = (b: BriefInput) => b.answers as unknown as IntelAnswer[];

/* ================================= the probe ============================== */

const CASES: { name: string; input: BriefInput; rival: string }[] = [
  { name: "Kestrel Uptime challenger fixture", input: fixtureBriefInput(), rival: "Notion" },
  { name: "riddled dominant (markdown + mid-word cuts)", input: riddledBriefInput(), rival: "Northwind" },
];

describe("preview invariants — the ONE pipeline makes the bug class impossible", () => {
  for (const { name, input, rival } of CASES) {
    describe(name, () => {
      it("buildBrief: every string in the whole output graph is a clean preview", () => {
        const brief = buildBrief(input);
        // sanity: the walker actually saw content (not a vacuous pass)
        const strings = stringsOf(brief);
        expect(strings.length).toBeGreaterThan(0);
        assertCleanPreview("buildBrief", strings);
      });

      it("buildRivalCompare: every string in the whole output graph is a clean preview", () => {
        const cmp = buildRivalCompare(compareOf(input), rival);
        assertCleanPreview("buildRivalCompare", stringsOf(cmp));
      });

      it("sendElsewhere + mergedPricingClaims emit already-cleaned strings", () => {
        const answers = answersOf(input);
        assertCleanPreview("sendElsewhere", stringsOf(sendElsewhere(answers, input.brand.name, input.brand.aliases)));
        assertCleanPreview("mergedPricingClaims", stringsOf(mergedPricingClaims(answers)));
      });

      it("raw derivations (perception / rival-gaps / share-of-voice) are FULLY cleaned by the pipeline", () => {
        const answers = answersOf(input);
        assertPipelineCleans("perceptionClaims", stringsOf(perceptionClaims(answers)));
        assertPipelineCleans("rivalGaps", stringsOf(rivalGaps(answers, input.corpus, input.brand.name, input.brand.aliases)));
        const sov = Object.entries(input.scores?.share_of_voice ?? {}) as [string, number][];
        const brandCount = input.scores?.share_of_voice?.[input.brand.name] ?? 0;
        assertPipelineCleans("shareOfVoiceRows", stringsOf(shareOfVoiceRows(sov, input.brand.name, brandCount)));
      });
    });
  }
});
