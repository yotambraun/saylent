// THE BRIEF — deterministic ($0) answer-first composer. Mirrors the style of
// report-intel.test.ts: the challenger case loads the REAL Kestrel Uptime smoke
// capture (fixtures/run.json — a real audit of our own hosted fictional brand,
// rival names pseudonymized by scripts/pseudonymize-run.ts), the
// dominant/thin cases inline-build the
// shapes. Every card must self-hide when its data is absent, keep its teaser
// ≤90 chars, anchor into a real dossier section, and only follow up to cards
// that actually rendered.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildBrief, storyBranch, type BriefInput } from "./brief";

/* The dossier section ids the Brief may deep-link into. Verified by grepping
 * dossier.tsx for `id=` (battlefield, verdicts, voice, gates, fix-plan, method —
 * note the fix section anchor is "fix-plan", not "fixes"). */
const KNOWN_ANCHORS = new Set(["battlefield", "verdicts", "voice", "gates", "fix-plan", "method", "source-map"]);

/* ------- load the real Kestrel Uptime smoke capture (challenger fixture) --- */
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

function fixtureInput(): BriefInput {
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

/* -------------------------------- helpers --------------------------------- */
function assertBriefInvariants(brief: ReturnType<typeof buildBrief>) {
  const ids = new Set(brief.cards.map((c) => c.id));
  for (const c of brief.cards) {
    expect(c.teaser.length, `teaser "${c.teaser}" ≤90`).toBeLessThanOrEqual(90);
    expect(KNOWN_ANCHORS.has(c.anchor), `anchor "${c.anchor}" is a real dossier id`).toBe(true);
    expect(c.followups.length).toBeLessThanOrEqual(3);
    for (const f of c.followups) {
      expect(ids.has(f), `followup "${f}" of ${c.id} exists`).toBe(true);
      expect(f).not.toBe(c.id);
    }
  }
  // ids are unique
  expect(ids.size).toBe(brief.cards.length);
}

/* ============================ storyBranch ================================= */

describe("storyBranch", () => {
  it("thin under 8 scored answers, dominant at ≥80% recommended, else challenger", () => {
    expect(storyBranch(4, 4)).toBe("thin");
    expect(storyBranch(7, 7)).toBe("thin"); // thin wins even at 100%
    expect(storyBranch(48, 45)).toBe("dominant"); // 45 ≥ 0.8·48 (38.4)
    expect(storyBranch(48, 30)).toBe("challenger");
    expect(storyBranch(12, 1)).toBe("challenger");
  });
});

/* ================ challenger — real Kestrel Uptime smoke =================== */

describe("buildBrief — Kestrel Uptime smoke capture (challenger)", () => {
  const brief = buildBrief(fixtureInput());

  it("branches to the challenger story (9 scored, recommended in 0)", () => {
    expect(brief.story).toBe("challenger");
  });

  it("leads the hero with the non-zero findings when the brand is absent", () => {
    // recommended = mentioned = 0, so "0 of 9" alone is not a report: the hero
    // leads with who wins those answers and which page the engines lean on.
    expect(brief.hero.headline).toContain("Beacon Uptime");
    expect(brief.hero.headline).toMatch(/cite most/);
    // the zero stays on screen, in the sub line and the first tile
    expect(brief.hero.headline).toContain("none of the 9 scored answers");
    expect(brief.hero.sub).toContain("0 of 9");
    expect(brief.hero.stats[0]).toEqual({ label: "Recommended", value: "0 of 9" });
    // and the first fix is named, so the reader has somewhere to go
    expect(brief.hero.sub).toMatch(/First move: .+\./);
    // every hero stat carries a real count, never a bare percentage
    for (const s of brief.hero.stats) expect(s.value).toMatch(/\d/);
  });

  it("the Mentioned and Top rival hero tiles deep-link into their receipt, same anchor contract as the cards", () => {
    // stats[0] (Recommended) opens the am-i-in-the-answer card via a click
    // handler, not a dossier anchor — it carries no href.
    expect(brief.hero.stats[0].href).toBeUndefined();
    const mentioned = brief.hero.stats.find((s) => s.label === "Mentioned")!;
    expect(mentioned.href).toBe("verdicts");
    expect(KNOWN_ANCHORS.has(mentioned.href!), `anchor "${mentioned.href}" is a real dossier id`).toBe(true);
    const topRival = brief.hero.stats.find((s) => s.label === "Top rival")!;
    expect(topRival.href).toBe("voice");
    expect(KNOWN_ANCHORS.has(topRival.href!), `anchor "${topRival.href}" is a real dossier id`).toBe(true);
  });

  it("counts the hero and the top cards on ONE base: scored answers", () => {
    const answered = 9; // fixture scores.overall.answered (category + problem)
    const amIn = brief.cards.find((c) => c.id === "am-i-in-the-answer")!;
    const shareBase = [
      brief.hero.headline,
      brief.hero.sub,
      ...brief.hero.stats.map((s) => s.value),
      amIn.teaser,
      ...amIn.blocks.flatMap((b) => (b.kind === "stat" ? [b.value] : [])),
    ];
    for (const text of shareBase) {
      for (const [, denom] of text.matchAll(/\d+(?:–\d+)? of (\d+)/g)) {
        expect(Number(denom), `"${text}" counts out of ${denom}, not ${answered}`).toBe(answered);
      }
    }
  });

  it("keeps branded and head-to-head facts separate, and counts them in ANSWERS", () => {
    // 3 branded ANSWERS back the brand twice, 6 head-to-head answers once.
    // Neither may be folded into the headline's denominator, and neither may
    // call an answer count a question count (one question asked on four
    // engines is four answers).
    expect(brief.hero.notes).toContain("In the 3 answers to questions that name you, the engines back you in 2.");
    expect(brief.hero.notes).toContain("In the 6 head-to-head answers, the engines back you in 1.");
    expect(brief.hero.headline).not.toContain("branded");
    expect(brief.hero.headline).not.toContain(" of 3");
    expect(brief.hero.sub).not.toContain(" of 3");
  });

  it("states the base once, in the hero and in the method card", () => {
    expect(brief.hero.basis).toContain("scored answers");
    const trust = brief.cards.find((c) => c.id === "trust-this")!;
    const kv = trust.blocks.find((b) => b.kind === "kv");
    expect(kv?.kind === "kv" && kv.rows.some((r) => r.k === "What counts as scored")).toBe(true);
  });

  it("makes every other base name itself in its own sentence", () => {
    const whoWins = brief.cards.find((c) => c.id === "who-wins-instead")!;
    expect(whoWins.teaser).toContain("all question types");
    expect(whoWins.teaser).toContain("answers that skip you");
    const steers = brief.cards.find((c) => c.id === "sent-elsewhere")!;
    expect(steers.teaser).toContain("steer conditions");
  });

  it("reconciles: recommended ≤ mentioned ≤ answered", () => {
    const o = fixture.run.scores as { overall: { answered: number; recommended: number; mentioned: number } };
    expect(o.overall.recommended).toBeLessThanOrEqual(o.overall.mentioned);
    expect(o.overall.mentioned).toBeLessThanOrEqual(o.overall.answered);
    // and the composer never prints a numerator above its denominator
    const nums = [brief.hero.headline, brief.hero.sub, ...brief.hero.stats.map((s) => s.value)];
    for (const text of nums) {
      for (const [, num, denom] of text.matchAll(/(\d+) of (\d+)/g)) {
        expect(Number(num)).toBeLessThanOrEqual(Number(denom));
      }
    }
  });

  it("self-hides the site-coverage card when the capture has no site_pages snapshot", () => {
    const ids = brief.cards.map((c) => c.id);
    // no site_pages snapshot in the capture (bundle-to-fixture.ts never carries
    // it, same as the old capture-fixture.ts export) → no site-coverage card
    expect(ids).not.toContain("site-coverage");
  });

  it("renders price-claims and sent-elsewhere when the run's real data backs them", () => {
    const ids = brief.cards.map((c) => c.id);
    // the run mined real pricing quotes (q18) and real verdict.segments
    // (rival "why recommend it" text) → both cards render, self-hiding proven
    // by the absent-data site-coverage case above
    expect(ids).toContain("price-claims");
    expect(ids).toContain("sent-elsewhere");
  });

  it("renders the cards the smoke run DOES back, first card = am-i-in-the-answer", () => {
    const ids = brief.cards.map((c) => c.id);
    expect(ids[0]).toBe("am-i-in-the-answer");
    // rival uptime-monitoring tools dominate the absences → who-wins-instead is present
    expect(ids).toContain("who-wins-instead");
    // 23 domain checks (3 fail) → bots-read-site is present
    expect(ids).toContain("bots-read-site");
    expect(ids).toContain("trust-this");
  });

  it("renders the do-first plan as a ranked moves block with effort/tti/draft-ready", () => {
    const card = brief.cards.find((c) => c.id === "do-first");
    expect(card, "do-first card renders for the smoke fixes").toBeTruthy();
    const moves = card!.blocks.find((b) => b.kind === "moves");
    expect(moves?.kind).toBe("moves");
    if (moves?.kind === "moves") {
      expect(moves.rows.length).toBeGreaterThan(0);
      // ranked 1..N, full titles, no raw weight leak
      expect(moves.rows[0].rank).toBe(1);
      moves.rows.forEach((r, i) => expect(r.rank).toBe(i + 1));
      for (const r of moves.rows) {
        expect(r.title.length).toBeGreaterThan(0);
        expect(r.title).not.toContain("weight");
      }
      // the smoke fixes carry stored effort (M), a verbatim time-to-impact range,
      // engines, and a drafted artifact → at least one move is draft-ready.
      expect(moves.rows.some((r) => !!r.effort)).toBe(true);
      expect(moves.rows.some((r) => !!r.timeToImpact)).toBe(true);
      expect(moves.rows.some((r) => (r.engines?.length ?? 0) > 0)).toBe(true);
      expect(moves.rows.some((r) => r.draftReady === true)).toBe(true);
    }
    // the drafted-pitch pointer appears when any move is draft-ready
    const draftLine = card!.blocks.find((b) => b.kind === "text" && /drafted?|draft is written/i.test(b.text));
    expect(draftLine?.kind).toBe("text");
  });

  it("gives deciding-pages a pages table carrying engines + presence + receipts", () => {
    const card = brief.cards.find((c) => c.id === "deciding-pages");
    expect(card, "deciding-pages renders for the smoke corpus").toBeTruthy();
    const pages = card!.blocks.find((b) => b.kind === "pages");
    expect(pages?.kind).toBe("pages");
    if (pages?.kind === "pages") {
      expect(pages.rows.length).toBeGreaterThan(0);
      expect(pages.rows.length).toBeLessThanOrEqual(6);
      for (const r of pages.rows) {
        expect(r.host.length).toBeGreaterThan(0);
        expect(r.url.length).toBeGreaterThan(0);
        expect(r.cited).toBeGreaterThan(0);
        expect(r.engines.length).toBeGreaterThan(0);
        expect(r.receipt?.kind).toBe("page");
        // present is a real tri-state, never undefined
        expect(r.present === true || r.present === false || r.present === null).toBe(true);
      }
    }
  });

  it("gives bots-read-site a status checklist (all crawler gates, mixed states)", () => {
    const card = brief.cards.find((c) => c.id === "bots-read-site")!;
    const status = card.blocks.find((b) => b.kind === "status");
    expect(status?.kind).toBe("status");
    if (status?.kind === "status") {
      // every live-fetch + robots gate is shown (16 bot checks in the smoke run)
      const botRows = status.rows.filter(
        (r) => r.label.startsWith("live fetch as ") || r.label.startsWith("robots: "),
      );
      expect(botRows.length).toBe(16);
      // EVERY check is a row now, in both formats: the card used to fold the
      // non-bot passes into "+N more checks passed" while the full report
      // listed all of them, so the two gate tables disagreed.
      expect(status.rows.some((r) => r.state === "fail")).toBe(true);
      expect(status.rows.some((r) => /more checks passed/.test(r.label))).toBe(false);
      expect(status.rows.length).toBe((fixture.domain_checks as unknown[]).length);
      for (const r of status.rows) {
        expect(["pass", "fail", "warn", "info"]).toContain(r.state);
      }
    }
  });

  it("gives trust-this a real kv method table", () => {
    const card = brief.cards.find((c) => c.id === "trust-this")!;
    const kv = card.blocks.find((b) => b.kind === "kv");
    expect(kv?.kind).toBe("kv");
    if (kv?.kind === "kv") {
      const keys = kv.rows.map((r) => r.k);
      expect(keys).toContain("Method");
      expect(keys).toContain("Scored answers");
      const answers = kv.rows.find((r) => r.k === "Scored answers");
      expect(answers?.v).toMatch(/^\d+$/);
    }
  });

  it("keeps every teaser ≤90, every anchor real, every followup live", () => {
    expect(brief.cards.length).toBeGreaterThan(0);
    assertBriefInvariants(brief);
  });

  it("attaches an openable receipt to a who-wins-instead rival bar", () => {
    const card = brief.cards.find((c) => c.id === "who-wins-instead")!;
    const bars = card.blocks.find((b) => b.kind === "bars");
    expect(bars?.kind).toBe("bars");
    if (bars?.kind === "bars") {
      const withReceipt = bars.rows.find((r) => r.receipt);
      expect(withReceipt?.receipt?.kind).toBe("answer");
      // no DB ids on the fixture → the composite qid|engine handle the UI resolves
      expect(withReceipt?.receipt?.id).toMatch(/^q\d+\|/);
    }
  });
});

/* ==================== dominant — Kestrel-like inline ======================== */

describe("buildBrief — dominant (Kestrel-like: 48 scored, 44–46 band)", () => {
  const input: BriefInput = {
    brand: { name: "Kestrel", domain: "kestrel.example", aliases: ["Kestrel"], competitors: ["Northwind", "Circuit"] },
    scores: {
      overall: { answered: 48, recommended: 45, mentioned: 47, rec_rate: 0.9375, mention_rate: 0.979 },
      per_engine: {
        chatgpt: { answered: 12, recommended: 12, mentioned: 12, rec_rate: 1, mention_rate: 1 },
        claude: { answered: 12, recommended: 11, mentioned: 12, rec_rate: 0.92, mention_rate: 1 },
        gemini: { answered: 12, recommended: 11, mentioned: 12, rec_rate: 0.92, mention_rate: 1 },
        perplexity: { answered: 12, recommended: 11, mentioned: 11, rec_rate: 0.92, mention_rate: 0.92 },
      },
      share_of_voice: { Kestrel: 40, Northwind: 12, Circuit: 8 },
      recommended_band: {
        overall: { min: 44, max: 46 },
        per_engine: {
          chatgpt: { min: 12, max: 12 },
          claude: { min: 10, max: 12 },
          gemini: { min: 10, max: 12 },
          perplexity: { min: 10, max: 12 },
        },
      },
    },
    answers: [
      {
        qid: "q01",
        qtype: "category",
        engine: "chatgpt",
        ok: true,
        verdict: {
          brand_present: true,
          mention_type: "recommended",
          segments: [{ segment: "large transfers", winner: "Northwind", reason: "higher limits" }],
          pricing_claims: ["0.4% conversion fee"],
        },
      },
      {
        qid: "q02",
        qtype: "category",
        engine: "claude",
        ok: true,
        verdict: {
          brand_present: true,
          mention_type: "recommended",
          segments: [{ segment: "crypto holders", winner: "Northwind", reason: "native crypto trading" }],
          pricing_claims: ["0.5% conversion fee"],
        },
      },
      {
        qid: "q03",
        qtype: "problem",
        engine: "gemini",
        ok: true,
        verdict: {
          brand_present: true,
          mention_type: "listed",
          segments: [{ segment: "merchant accounts", winner: "Circuit", reason: "wider checkout acceptance" }],
        },
      },
    ],
    corpus: [],
    checks: [],
    fixes: [],
  };
  const brief = buildBrief(input);

  it("branches to dominant when the band midpoint clears 80% of scored answered", () => {
    expect(brief.story).toBe("dominant");
  });

  it("opens with sent-elsewhere — where a winning brand still leaks buyers", () => {
    expect(brief.cards[0].id).toBe("sent-elsewhere");
    // Northwind takes 2 of the 3 steers
    expect(brief.cards[0].teaser).toContain("Northwind");
  });

  it("puts the band counts in the hero (44–46 of 48)", () => {
    const hero = JSON.stringify(brief.hero);
    expect(hero).toContain("44");
    expect(hero).toContain("46");
    expect(hero).toContain("48");
    expect(brief.hero.headline).toMatch(/winning/i);
  });

  it("leaves the present-brand hero alone (no absent-brand lead)", () => {
    expect(brief.hero.headline).not.toContain("is in none of the");
    // and it still counts on the one base
    for (const s of brief.hero.stats) {
      for (const [, denom] of s.value.matchAll(/\d+(?:–\d+)? of (\d+)/g)) {
        expect(Number(denom)).toBe(48);
      }
    }
  });

  it("holds every Brief invariant", () => {
    assertBriefInvariants(brief);
  });
});

/* ============ Regression: composer-quality bugs found during manual QA on Kestrel ======= */
// A Kestrel-shaped DOMINANT input that reproduces every previously-verified bug:
// markdown-bold pricing claims incl. a substring-duplicate pair, exact dups
// across engines, a qualitative fee claim, an absent answer with an attributed
// rival why (markdown inside), praise (2-engine + 1-engine singleton) and a
// markdown risk claim. The story is dominant (48 scored, 44–46 band).
function kestrelBugInput(): BriefInput {
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
      share_of_voice: { Kestrel: 40, Northwind: 12, Circuit: 8 },
      recommended_band: { overall: { min: 44, max: 46 } },
    },
    answers: [
      // pricing group 1 — exact dup across 3 engines, one markdown-bold + trailing period
      { qid: "q01", qtype: "category", engine: "chatgpt", ok: true, verdict: { brand_present: true, mention_type: "recommended", pricing_claims: ["**Cash pickup, home delivery available.**"], claims: [{ text: "great exchange rates", kind: "praise" }], segments: [{ segment: "large transfers", winner: "Northwind", reason: "higher limits" }] } },
      { qid: "q02", qtype: "category", engine: "claude", ok: true, verdict: { brand_present: true, mention_type: "recommended", pricing_claims: ["Cash pickup, home delivery available"], claims: [{ text: "great exchange rates", kind: "praise" }], segments: [{ segment: "crypto holders", winner: "Northwind", reason: "native crypto" }] } },
      { qid: "q03", qtype: "category", engine: "gemini", ok: true, verdict: { brand_present: true, mention_type: "recommended", pricing_claims: ["cash pickup, home delivery available"], claims: [{ text: "**clean mobile app**", kind: "praise" }] } },
      // pricing group 2 — the substring-dup pair seen twice in manual QA
      { qid: "q04", qtype: "comparison", engine: "chatgpt", ok: true, verdict: { brand_present: true, mention_type: "recommended", pricing_claims: ["all transfers use the mid-market rate"], claims: [{ text: "**high fees on large amounts**", kind: "risk" }] } },
      { qid: "q05", qtype: "comparison", engine: "claude", ok: true, verdict: { brand_present: true, mention_type: "recommended", pricing_claims: ["all transfers use the mid-market rate, with a 0.35% fee"] } },
      // pricing group 3 — a qualitative fee claim (never "prices")
      { qid: "q06", qtype: "comparison", engine: "perplexity", ok: true, verdict: { brand_present: true, mention_type: "recommended", pricing_claims: ["transparent fees, no hidden costs"] } },
      // absent answers → who-wins-instead rivals + attributed whys (markdown in one)
      { qid: "q10", qtype: "problem", engine: "chatgpt", ok: true, verdict: { brand_present: false, mention_type: "absent", other_brands: [{ name: "Northwind", why: "lower fees on large transfers" }] } },
      { qid: "q11", qtype: "problem", engine: "claude", ok: true, verdict: { brand_present: false, mention_type: "absent", other_brands: [{ name: "Northwind", why: "lower fees on large transfers" }] } },
      { qid: "q12", qtype: "problem", engine: "gemini", ok: true, verdict: { brand_present: false, mention_type: "absent", other_brands: [{ name: "Circuit", why: "**wider** merchant acceptance" }] } },
    ],
    corpus: [],
    checks: [],
    fixes: [],
    valueProps: ["fast transfers", "mid-market rate", "multi-currency account", "debit card", "business tools"],
  };
}

/** Every human-visible string the Brief emits, for markdown-leak assertions. */
function allRenderedStrings(brief: ReturnType<typeof buildBrief>): string[] {
  const out: string[] = [brief.hero.headline, brief.hero.sub, brief.hero.basis, ...brief.hero.notes];
  for (const s of brief.hero.stats) out.push(s.label, s.value);
  for (const c of brief.cards) {
    out.push(c.teaser, c.question);
    for (const b of c.blocks) {
      if (b.kind === "text") out.push(b.text);
      else if (b.kind === "stat") out.push(b.label, b.value);
      else if (b.kind === "bars") {
        out.push(b.takeaway);
        for (const r of b.rows) out.push(r.label);
      } else if (b.kind === "list") {
        for (const it of b.items) out.push(it.text);
      } else if (b.kind === "quote") {
        out.push(b.text);
        if (b.attribution) out.push(b.attribution);
      } else if (b.kind === "status") {
        for (const r of b.rows) {
          out.push(r.label);
          if (r.detail) out.push(r.detail);
        }
      } else if (b.kind === "pages") {
        for (const r of b.rows) {
          out.push(r.host);
          if (r.title) out.push(r.title);
          out.push(...r.engines);
        }
      } else if (b.kind === "moves") {
        for (const r of b.rows) {
          out.push(r.title);
          if (r.effort) out.push(r.effort);
          if (r.engines) out.push(...r.engines);
        }
      } else if (b.kind === "kv") {
        for (const r of b.rows) out.push(r.k, r.v);
      }
    }
  }
  return out;
}

/** The strings this module AUTHORS (never verbatim engine passthrough) — the
 *  release-prep em-dash watermark rule applies only to these. Deliberately excludes
 *  quote text/attribution (engine passthrough), status details + page titles +
 *  move titles + kv sampled-values that can embed stored copy, and any teaser or
 *  text block that interpolates a raw claim (how-described/price-claims). What is
 *  left is pure connector copy: hero lines, stat labels, bar takeaways, kv keys,
 *  the method value, and the "+N" / draft summary lines. */
function authoredConnectorStrings(brief: ReturnType<typeof buildBrief>): string[] {
  const out: string[] = [brief.hero.headline, brief.hero.sub, brief.hero.basis, ...brief.hero.notes];
  for (const s of brief.hero.stats) out.push(s.label, s.value);
  for (const c of brief.cards) {
    out.push(c.question);
    for (const b of c.blocks) {
      if (b.kind === "bars") out.push(b.takeaway);
      else if (b.kind === "stat") out.push(b.label);
      else if (b.kind === "kv") for (const r of b.rows) out.push(r.k);
    }
  }
  return out;
}

describe("buildBrief — composer-quality regression bugs (Kestrel-shaped dominant)", () => {
  const brief = buildBrief(kestrelBugInput());
  const price = () => brief.cards.find((c) => c.id === "price-claims");
  const described = () => brief.cards.find((c) => c.id === "how-described");
  const whoWins = () => brief.cards.find((c) => c.id === "who-wins-instead");

  // Bug 1 — headline counts DISTINCT fee FIGURES (the one real 0.35%),
  // never the raw claim total; the claim list still collapses to 3 distinct lines.
  it("headlines the distinct fee FIGURE(s) and renders a figures line", () => {
    const card = price()!;
    expect(card, "price-claims renders").toBeTruthy();
    // only one numeric figure (0.35%) is present → "1 different fee figure"
    expect(card.teaser).toContain("1 different fee figure");
    expect(card.teaser).not.toContain("prices");
    expect(card.teaser).not.toContain("fee claims"); // wording moved to figures
    const figLine = card.blocks.find((b) => b.kind === "text" && b.text.startsWith("The figures:"));
    expect(figLine?.kind).toBe("text");
    if (figLine?.kind === "text") expect(figLine.text).toContain("0.35%");
    // Regression: the distinct claims render as quote blocks, not list lines
    const quotes = card.blocks.filter((b) => b.kind === "quote");
    // the 5 raw pricing_claims collapse to 3 distinct rendered quotes
    expect(quotes.length).toBe(3);
    if (quotes[0].kind === "quote") {
      // the short "mid-market rate" claim is merged INTO the longer 0.35% sentence
      const midRate = quotes.filter((q) => q.kind === "quote" && /mid-market rate/i.test(q.text));
      expect(midRate.length).toBe(1);
      if (midRate[0].kind === "quote") expect(midRate[0].text).toContain("0.35%");
      // exact-dup group across 3 engines sums its attribution into `count`
      const cashPickup = quotes.find((q) => q.kind === "quote" && /cash pickup/i.test(q.text));
      expect(cashPickup?.kind === "quote" && cashPickup.count).toBe(3);
    }
  });

  // Regression: plural figures headline + capped figures line when several numbers circulate
  it("headlines plural fee figures and caps the figures line at 6", () => {
    const rich = buildBrief({
      ...kestrelBugInput(),
      answers: [
        { qid: "p1", qtype: "comparison", engine: "chatgpt", ok: true, verdict: { brand_present: true, mention_type: "recommended", pricing_claims: ["fees run 0.33–0.6% on most routes"] } },
        { qid: "p2", qtype: "comparison", engine: "claude", ok: true, verdict: { brand_present: true, mention_type: "recommended", pricing_claims: ["a flat 0.35% conversion fee"] } },
        { qid: "p3", qtype: "comparison", engine: "gemini", ok: true, verdict: { brand_present: true, mention_type: "recommended", pricing_claims: ["0.43% and 0.57% on exotic pairs"] } },
        { qid: "p4", qtype: "comparison", engine: "perplexity", ok: true, verdict: { brand_present: true, mention_type: "recommended", pricing_claims: ["a fixed $31 fee over $25,000"] } },
      ],
    });
    const card = rich.cards.find((c) => c.id === "price-claims")!;
    expect(card.teaser).toContain("6 different fee figures");
    const figLine = card.blocks.find((b) => b.kind === "text" && b.text.startsWith("The figures:"));
    expect(figLine?.kind).toBe("text");
    if (figLine?.kind === "text") {
      expect(figLine.text).toContain("0.33–0.6%");
      expect(figLine.text).toContain("$31");
      expect(figLine.text).toContain("$25,000");
    }
  });

  // Bug 2 — no raw markdown or citation brackets survive in ANY rendered string
  it("strips markdown from every rendered string (no ** or [n] leaks)", () => {
    for (const s of allRenderedStrings(brief)) {
      expect(s, `"${s}" has no bold markdown`).not.toMatch(/\*\*/);
      expect(s, `"${s}" has no citation bracket`).not.toMatch(/\[\d+\]/);
    }
  });

  // Bug 3 — the "of 4" denominator noun is always plural ("1 of 4 engines")
  it("never renders the singular 'of 4 engine'", () => {
    for (const s of allRenderedStrings(brief)) {
      expect(s, `"${s}"`).not.toMatch(/of 4 engine\b(?!s)/);
    }
  });

  // Bug 4 — every who-wins-instead why is a quote attributed to a rival
  it("attributes every rival why-quote to a rival (max 3), openable", () => {
    const card = whoWins()!;
    expect(card, "who-wins-instead renders").toBeTruthy();
    const quotes = card.blocks.filter((b) => b.kind === "quote");
    expect(quotes.length).toBeGreaterThan(0);
    expect(quotes.length).toBeLessThanOrEqual(3);
    for (const q of quotes) {
      if (q.kind !== "quote") continue;
      expect(q.text.length, `"${q.text}" has text`).toBeGreaterThan(0);
      expect(q.attribution, `"${q.text}" is attributed to a rival`).toBeTruthy();
      expect(q.receipt?.kind, "why quote opens an answer receipt").toBe("answer");
    }
    expect(quotes.some((q) => q.kind === "quote" && q.attribution === "Northwind")).toBe(true);
  });

  // Bug 5 — how-described: synthesized teaser, ≤3 value props, singleton suffix dropped
  it("synthesizes the how-described teaser from praise + one doubt", () => {
    const card = described()!;
    expect(card, "how-described renders").toBeTruthy();
    expect(card.teaser).toContain("praise");
    expect(card.teaser).toContain("doubt");
    // it is not a raw quote slice
    expect(card.teaser.startsWith('"')).toBe(false);
  });

  it("caps the value-props line at 3 props", () => {
    const card = described()!;
    const vpBlock = card.blocks.find((b) => b.kind === "text" && b.text.startsWith("How engines could describe you"));
    expect(vpBlock?.kind).toBe("text");
    if (vpBlock?.kind === "text") {
      // 3 props => exactly 2 " · " separators
      expect((vpBlock.text.match(/ · /g) ?? []).length).toBe(2);
    }
  });

  it("carries praise consensus in the quote count: none for a singleton, 2 for a pair", () => {
    const card = described()!;
    const quotes = card.blocks.filter((b) => b.kind === "quote");
    const single = quotes.find((q) => q.kind === "quote" && q.text.includes("clean mobile app"));
    const shared = quotes.find((q) => q.kind === "quote" && q.text.includes("great exchange rates"));
    // singleton praise: no engine count, attributed to the one engine, verbatim text
    expect(single?.kind).toBe("quote");
    if (single?.kind === "quote") {
      expect(single.count, "singleton praise carries no consensus count").toBeUndefined();
      expect(single.attribution, "singleton praise names its one engine").toBeTruthy();
    }
    // 2-engine praise keeps the count of 2
    expect(shared?.kind).toBe("quote");
    if (shared?.kind === "quote") expect(shared.count).toBe(2);
  });

  // Bug 6 — every teaser ≤90 and markdown-clean
  it("keeps every teaser ≤90 chars and markdown-clean", () => {
    for (const c of brief.cards) {
      expect(c.teaser.length, `teaser "${c.teaser}"`).toBeLessThanOrEqual(90);
      expect(c.teaser).not.toMatch(/\*\*/);
    }
    assertBriefInvariants(brief);
  });
});

/* ======== Regression: no em-dash AI-tell in composer-authored strings ======= */
// The release-prep rule: the em-dash "—" (U+2014) used as a sentence
// connector is an AI-tell and must not appear in strings the Brief AUTHORS.
// Verbatim engine quotes/claims/segments (receipts) are exempt; en-dash ranges
// ("44–46", U+2013) are fine. Asserted on the authored connector fields only.
const EM_DASH = "—";
describe("buildBrief — no em-dash AI-tell in authored copy", () => {
  it("challenger (Kestrel Uptime smoke): no em-dash in authored connector strings", () => {
    const brief = buildBrief(fixtureInput());
    for (const s of authoredConnectorStrings(brief)) {
      expect(s, `authored "${s}" has no em-dash connector`).not.toContain(EM_DASH);
    }
    // the challenger headline is fully authored — an explicit guard
    expect(brief.hero.headline).not.toContain(EM_DASH);
  });

  it("dominant (Kestrel-shaped): no em-dash in authored connector strings", () => {
    const brief = buildBrief(kestrelBugInput());
    for (const s of authoredConnectorStrings(brief)) {
      expect(s, `authored "${s}" has no em-dash connector`).not.toContain(EM_DASH);
    }
    expect(brief.hero.headline).not.toContain(EM_DASH);
    // en-dash numeric ranges are still allowed and present (44–46)
    expect(brief.hero.stats.some((s) => s.value.includes("–"))).toBe(true);
  });
});

/* ===== Regression: site-coverage + health-backed kv (dominant, site_pages) ==== */
describe("buildBrief — site-coverage + health kv (dominant with site_pages)", () => {
  const input: BriefInput = {
    brand: { name: "Kestrel", domain: "kestrel.example", aliases: ["Kestrel"], competitors: ["Northwind"] },
    scores: {
      overall: { answered: 48, recommended: 45, mentioned: 47, rec_rate: 0.94, mention_rate: 0.98 },
      per_engine: {
        chatgpt: { answered: 12, recommended: 12, mentioned: 12, rec_rate: 1, mention_rate: 1 },
        claude: { answered: 12, recommended: 11, mentioned: 12, rec_rate: 0.92, mention_rate: 1 },
        gemini: { answered: 12, recommended: 11, mentioned: 12, rec_rate: 0.92, mention_rate: 1 },
        perplexity: { answered: 12, recommended: 11, mentioned: 11, rec_rate: 0.92, mention_rate: 0.92 },
      },
      recommended_band: { overall: { min: 44, max: 46 } },
    },
    answers: [
      { qid: "q01", qtype: "category", engine: "chatgpt", question: "best way to send money abroad?", ok: true, verdict: { brand_present: true, mention_type: "recommended" } },
      { qid: "q02", qtype: "comparison", engine: "claude", question: "kestrel vs northwind for large transfers?", ok: true, verdict: { brand_present: true, mention_type: "recommended" } },
      { qid: "q03", qtype: "problem", engine: "gemini", question: "cheapest way to hold multiple currencies?", ok: true, verdict: { brand_present: true, mention_type: "listed" } },
    ],
    corpus: [
      // a page on the brand's OWN domain, cited for q01 → q01 is covered
      { url: "https://kestrel.example/pricing", final_url: "https://kestrel.example/pricing", title: "Kestrel pricing", page_type: "brand_owned", cited_by: { chatgpt: 2 }, cited_for_qids: ["q01"], brand_present: true, competitors_present: [], opportunity: false },
    ],
    checks: [],
    fixes: [],
    health: { answers: { chatgpt: { got: 23, expected: 23 }, claude: { got: 23, expected: 23 }, gemini: { got: 23, expected: 23 }, perplexity: { got: 23, expected: 23 } } },
    sitePages: [
      { url: "https://kestrel.example/pricing", title: "Kestrel pricing" },
      { url: "https://kestrel.example/about", title: "About Kestrel" },
    ],
  };
  const brief = buildBrief(input);

  it("renders site-coverage with a stat + uncovered-question list", () => {
    const card = brief.cards.find((c) => c.id === "site-coverage")!;
    expect(card, "site-coverage renders when site_pages present").toBeTruthy();
    const stat = card.blocks.find((b) => b.kind === "stat");
    expect(stat?.kind).toBe("stat");
    if (stat?.kind === "stat") expect(stat.value).toMatch(/^\d+ of \d+$/);
    // q02 + q03 have no own-domain page cited → they are gaps (uncovered)
    const list = card.blocks.find((b) => b.kind === "list");
    expect(list?.kind).toBe("list");
    if (list?.kind === "list") {
      expect(list.items.length).toBeGreaterThan(0);
      expect(list.items.some((i) => /northwind|currencies/i.test(i.text))).toBe(true);
    }
  });

  it("carries the health-backed 'Engines answered' kv row (4 of 4, 23/23 each)", () => {
    const card = brief.cards.find((c) => c.id === "trust-this")!;
    const kv = card.blocks.find((b) => b.kind === "kv");
    expect(kv?.kind).toBe("kv");
    if (kv?.kind === "kv") {
      const engines = kv.rows.find((r) => r.k === "Engines answered");
      expect(engines?.v).toBe("4 of 4 (23/23 each)");
      // the range row uses the en-dash band, never an em-dash
      const range = kv.rows.find((r) => r.k === "Range we saw");
      expect(range?.v).toBe("44–46 of 48");
    }
  });

  it("holds every Brief invariant with the extended deck", () => {
    assertBriefInvariants(brief);
  });
});

/* ============ Regression: data-utilization additions ============= */
// A dominant Kestrel-shaped run that carries prominence, sentiment, a prior audit,
// a cited corpus with page types, and per-engine mention rates — the fields the
// naive cards left on the floor.
function addendumInput(): BriefInput {
  return {
    brand: { name: "Kestrel", domain: "kestrel.example", aliases: ["Kestrel"], competitors: ["Northwind"] },
    scores: {
      overall: { answered: 48, recommended: 45, mentioned: 47, rec_rate: 0.94, mention_rate: 0.9 },
      per_engine: {
        chatgpt: { answered: 12, recommended: 12, mentioned: 12, rec_rate: 1, mention_rate: 1 },
        claude: { answered: 12, recommended: 11, mentioned: 12, rec_rate: 0.92, mention_rate: 0.9 },
        gemini: { answered: 12, recommended: 11, mentioned: 12, rec_rate: 0.92, mention_rate: 0.8 },
        perplexity: { answered: 12, recommended: 11, mentioned: 11, rec_rate: 0.92, mention_rate: 0.7 },
      },
      recommended_band: { overall: { min: 44, max: 46 } },
    },
    answers: [
      { qid: "q01", qtype: "category", engine: "chatgpt", question: "best way to send money abroad?", ok: true, verdict: { brand_present: true, mention_type: "recommended", prominence: "first", sentiment: "positive" } },
      { qid: "q02", qtype: "comparison", engine: "claude", question: "kestrel vs northwind?", ok: true, verdict: { brand_present: true, mention_type: "recommended", prominence: "first", sentiment: "positive" } },
      { qid: "q03", qtype: "problem", engine: "gemini", question: "cheapest fx for freelancers?", ok: true, verdict: { brand_present: true, mention_type: "listed", prominence: "buried", sentiment: "negative", other_brands: [{ name: "Northwind", why: "lower fees on large transfers" }] } },
      { qid: "q04", qtype: "comparison", engine: "perplexity", question: "best multi-currency account?", ok: true, verdict: { brand_present: true, mention_type: "listed", prominence: "buried", sentiment: "neutral", other_brands: [{ name: "Northwind", why: "native crypto" }] } },
    ],
    corpus: [
      { url: "https://g2.com/kestrel", final_url: "https://g2.com/kestrel", title: "Kestrel reviews", page_type: "review_platform", cited_by: { chatgpt: 2, claude: 1 }, cited_for_qids: ["q01", "q02", "q03"], brand_present: false, competitors_present: ["Northwind"], opportunity: true },
      { url: "https://nerdwallet.com/best", final_url: "https://nerdwallet.com/best", title: "Best money transfer 2026", page_type: "listicle", cited_by: { gemini: 2, perplexity: 1 }, cited_for_qids: ["q01"], brand_present: false, competitors_present: ["Northwind"], opportunity: true },
      { url: "https://kestrel.example/pricing", final_url: "https://kestrel.example/pricing", title: "Kestrel pricing", page_type: "brand_owned", cited_by: { chatgpt: 1 }, cited_for_qids: ["q02"], brand_present: true, competitors_present: [], opportunity: false },
    ],
    checks: [],
    fixes: [],
    valueProps: ["fast transfers", "mid-market rate"],
    previous: { recommended: 43, answered: 48, date: "01 Jul" },
  };
}

describe("buildBrief — prominence / sentiment / where-from / delta / decides", () => {
  const brief = buildBrief(addendumInput());

  it("puts a real 'vs last audit' delta stat in the hero (+2 recommended)", () => {
    const delta = brief.hero.stats.find((s) => s.label === "vs last audit");
    expect(delta?.value).toBe("+2 recommended");
  });

  it("adds the prominence story to am-i-in-the-answer, on the scored base only", () => {
    const card = brief.cards.find((c) => c.id === "am-i-in-the-answer")!;
    const kv = card.blocks.find((b) => b.kind === "kv");
    expect(kv?.kind).toBe("kv");
    if (kv?.kind === "kv") {
      const first = kv.rows.find((r) => r.k === "Named first");
      const buried = kv.rows.find((r) => r.k === "Buried behind rivals");
      // 2 answers are named first and 2 are buried, but half of each pair is a
      // head-to-head question: this card counts scored answers, so it says 1.
      expect(first?.v).toBe("1 answer");
      expect(buried?.v).toBe("1 answer");
      // the buried line opens a receipt to a buried answer
      expect(buried?.receipt?.kind).toBe("answer");
    }
  });

  it("adds the sentiment tally to how-described (counts, not percentages)", () => {
    const card = brief.cards.find((c) => c.id === "how-described")!;
    const kv = card.blocks.filter((b) => b.kind === "kv");
    const rows = kv.flatMap((b) => (b.kind === "kv" ? b.rows : []));
    const pos = rows.find((r) => r.k === "Positive");
    const neg = rows.find((r) => r.k === "Negative");
    // ONE tone denominator, stated in the value: the answers that MENTION the
    // brand, never every answer that came back.
    expect(pos?.v).toBe("2 of 4");
    expect(neg?.v).toBe("1 of 4");
  });

  it("renders the where-from card with per-engine hosts + a channel-mix line", () => {
    const card = brief.cards.find((c) => c.id === "where-from")!;
    expect(card, "where-from renders for a cited corpus").toBeTruthy();
    expect(card.anchor).toBe("source-map");
    const kv = card.blocks.find((b) => b.kind === "kv");
    expect(kv?.kind).toBe("kv");
    if (kv?.kind === "kv") {
      expect(kv.rows.length).toBeGreaterThan(0);
      // each engine row names its top hosts and opens a page receipt
      expect(kv.rows.some((r) => r.v.includes("g2.com") || r.v.includes("nerdwallet.com"))).toBe(true);
      expect(kv.rows.some((r) => r.receipt?.kind === "page")).toBe(true);
    }
    // a mix line (text) accompanies it, em-dash-free
    const mix = card.blocks.filter((b) => b.kind === "text");
    expect(mix.length).toBeGreaterThan(0);
    for (const b of card.blocks) if (b.kind === "text") expect(b.text).not.toContain("—");
  });

  it("carries the 'decides q..' line on each deciding-pages row", () => {
    const card = brief.cards.find((c) => c.id === "deciding-pages")!;
    const pages = card.blocks.find((b) => b.kind === "pages");
    expect(pages?.kind).toBe("pages");
    if (pages?.kind === "pages") {
      expect(pages.rows.some((r) => r.decides?.startsWith("decides q"))).toBe(true);
    }
  });

  it("adds 'Last audit' to the trust-this kv table", () => {
    const card = brief.cards.find((c) => c.id === "trust-this")!;
    const kv = card.blocks.find((b) => b.kind === "kv");
    expect(kv?.kind).toBe("kv");
    if (kv?.kind === "kv") {
      const last = kv.rows.find((r) => r.k === "Last audit");
      expect(last?.v).toBe("01 Jul");
    }
  });

  it("self-hides the delta + prominence + previous rows when the fields are absent", () => {
    const bare = buildBrief({ ...addendumInput(), previous: null });
    expect(bare.hero.stats.some((s) => s.label === "vs last audit")).toBe(false);
    const trust = bare.cards.find((c) => c.id === "trust-this")!;
    const kv = trust.blocks.find((b) => b.kind === "kv");
    if (kv?.kind === "kv") expect(kv.rows.some((r) => r.k === "Last audit")).toBe(false);
  });

  it("holds every Brief invariant and stays em-dash-clean", () => {
    assertBriefInvariants(brief);
    for (const s of authoredConnectorStrings(brief)) expect(s).not.toContain("—");
  });
});

/* ============================ thin — 4 answers =========================== */

describe("buildBrief — thin (4 scored answers)", () => {
  const input: BriefInput = {
    brand: { name: "Nimbus", domain: "nimbus.io", aliases: ["Nimbus"], competitors: ["Acme"] },
    scores: {
      overall: { answered: 4, recommended: 1, mentioned: 2, rec_rate: 0.25, mention_rate: 0.5 },
      per_engine: {
        chatgpt: { answered: 2, recommended: 1, mentioned: 1, rec_rate: 0.5, mention_rate: 0.5 },
        claude: { answered: 2, recommended: 0, mentioned: 1, rec_rate: 0, mention_rate: 0.5 },
      },
      share_of_voice: { Acme: 5, Nimbus: 2 },
    },
    answers: [
      { qid: "q01", qtype: "category", engine: "chatgpt", ok: true, verdict: { brand_present: true, mention_type: "recommended" } },
      { qid: "q02", qtype: "category", engine: "claude", ok: true, verdict: { brand_present: false, mention_type: "absent" } },
      { qid: "q03", qtype: "problem", engine: "chatgpt", ok: true, verdict: { brand_present: true, mention_type: "listed" } },
      { qid: "q04", qtype: "problem", engine: "claude", ok: true, verdict: { brand_present: false, mention_type: "absent" } },
    ],
    corpus: [],
    checks: [],
    fixes: [],
  };
  const brief = buildBrief(input);

  it("branches to thin under 8 scored answers", () => {
    expect(brief.story).toBe("thin");
  });

  it("pivots the hero to data honesty, not a verdict", () => {
    expect(brief.hero.sub).toContain("4 scored answers");
    expect(brief.hero.stats.every((s) => /\d/.test(s.value))).toBe(true);
  });

  it("holds every Brief invariant with its trimmed deck", () => {
    assertBriefInvariants(brief);
  });
});
