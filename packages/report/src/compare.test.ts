// COMPARE — "you vs a specific rival" composer. Verified on BOTH surfaces the
// contract requires: the REAL Kestrel Uptime
// smoke capture (fixtures/run.json — a real audit of our own hosted fictional
// brand, rival names pseudonymized — the
// challenger / thin-data path) and an inline Kestrel-shaped DOMINANT input
// (segments + SOV + rival-owned pages — the aggregation path no fixture
// exercises). Pure + $0: no React/Supabase, just the stored rows.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRivalCompare,
  rivalOptions,
  type CompareInput,
  type RivalCompare,
} from "./compare";

/* ------- load the real Kestrel Uptime smoke capture (challenger fixture) --- */
interface Fixture {
  run: { scores: unknown };
  brand: { name: string; domain: string; aliases: string[]; competitors: string[] };
  answers: unknown[];
  corpus_pages: unknown[];
}
const fixture = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "fixtures/run.json"), "utf8"),
) as Fixture;

function fixtureInput(): CompareInput {
  return {
    brand: fixture.brand,
    scores: fixture.run.scores as CompareInput["scores"],
    answers: fixture.answers as CompareInput["answers"],
    corpus: fixture.corpus_pages as CompareInput["corpus"],
  };
}

/* -------------------------------- helpers --------------------------------- */
/** Every human-visible string a compare emits — for markdown-leak assertions. */
function allStrings(c: RivalCompare): string[] {
  const out: string[] = [c.snapshotNote];
  if (c.grid) for (const r of c.grid.rows) out.push(r.question);
  if (c.counts) for (const ct of c.counts) out.push(ct.metric, ct.note ?? "");
  if (c.prominence) for (const l of c.prominence.lines) out.push(l.label);
  if (c.pagesTheyOwn) for (const p of c.pagesTheyOwn.pages) out.push(p.host);
  if (c.steers) for (const s of c.steers.items) out.push(s.segment, s.reason);
  return out;
}

/** Assert invariants every compare must hold regardless of input shape. */
function assertCompareInvariants(c: RivalCompare) {
  // no markdown leaks anywhere in authored copy
  for (const s of allStrings(c)) {
    expect(s.includes("**"), `no bold marker in "${s}"`).toBe(false);
    expect(/\[\d+\]/.test(s), `no [n] citation in "${s}"`).toBe(false);
  }
  // every grid cell either has an answer receipt or is an empty (null) cell
  if (c.grid) {
    for (const r of c.grid.rows)
      for (const cell of r.cells) {
        if (cell.favor === null) expect(cell.receipt).toBeUndefined();
        else expect(cell.receipt?.kind).toBe("answer");
      }
    // caps are honest
    expect(c.grid.more).toBeGreaterThanOrEqual(0);
    expect(c.grid.rows.length).toBeLessThanOrEqual(24);
  }
  if (c.pagesTheyOwn) {
    for (const p of c.pagesTheyOwn.pages) {
      expect(p.receipt.kind).toBe("page");
      // decides is a qid string[] (the mono "decides q01 · q07" micro-line source)
      expect(Array.isArray(p.decides)).toBe(true);
      for (const q of p.decides) expect(typeof q).toBe("string");
    }
    expect(c.pagesTheyOwn.pages.length).toBeLessThanOrEqual(8);
  }
  // prominence duel: consistent counts, every emitted bucket carries an answer receipt
  if (c.prominence) {
    expect(c.prominence.coAppearances).toBeGreaterThan(0);
    expect(c.prominence.namedFirst + c.prominence.buried).toBeLessThanOrEqual(
      c.prominence.coAppearances,
    );
    for (const l of c.prominence.lines) {
      expect(l.count).toBeGreaterThan(0);
      expect(l.receipt?.kind).toBe("answer");
    }
  }
  if (c.steers) expect(c.steers.items.length).toBeLessThanOrEqual(8);
}

/* ================ challenger — real Kestrel Uptime smoke =================== */

describe("rivalOptions — Kestrel Uptime smoke capture", () => {
  const opts = rivalOptions(fixtureInput());

  it("ranks rivals by mention count, Beacon Uptime first, capped at 8", () => {
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.length).toBeLessThanOrEqual(8);
    expect(opts[0].name).toBe("Beacon Uptime");
    expect(opts[0].mentions).toBe(9); // Beacon Uptime's SOV count
    // descending by mentions
    for (let i = 1; i < opts.length; i++)
      expect(opts[i - 1].mentions).toBeGreaterThanOrEqual(opts[i].mentions);
  });

  it("never lists the audited brand or an alias as a rival", () => {
    for (const o of opts) {
      expect(o.name.toLowerCase()).not.toBe("kestrel uptime");
      expect(o.name.toLowerCase()).not.toBe("saylent-kestrel.vercel.app");
    }
  });
});

describe("buildRivalCompare — Kestrel Uptime vs Beacon Uptime (challenger)", () => {
  const c = buildRivalCompare(fixtureInput(), "Beacon Uptime");

  it("recognises Beacon Uptime as a real mined rival", () => {
    expect(c.rivalKnown).toBe(true);
    expect(c.snapshotNote).toContain("Beacon Uptime");
  });

  it("builds a head-to-head grid over the scored questions with contested rows on top", () => {
    expect(c.grid).not.toBeNull();
    expect(c.grid!.engines.length).toBeGreaterThan(0);
    expect(c.grid!.rows.length).toBeGreaterThan(0);
    // at least one cell favours the rival (Beacon Uptime wins several absent answers)
    const favors = c.grid!.rows.flatMap((r) => r.cells.map((cell) => cell.favor));
    expect(favors).toContain("rival");
    // contested rows sort ahead of uncontested ones
    const idx = c.grid!.rows.findIndex((r) => !r.contested);
    if (idx !== -1)
      expect(c.grid!.rows.slice(idx).every((r) => !r.contested)).toBe(true);
  });

  it("counts mentions and recommendations with the honest asymmetry note", () => {
    expect(c.counts).not.toBeNull();
    const mentions = c.counts!.find((x) => x.metric.startsWith("Mentions"))!;
    expect(mentions.rival).toBe(9); // Beacon Uptime SOV
    expect(mentions.you).toBe(0); // Kestrel Uptime never mentioned → overall.mentioned fallback
    const rec = c.counts!.find((x) => x.metric.startsWith("Recommended"))!;
    expect(rec.you).toBe(0); // Kestrel Uptime never recommended
    expect(rec.note).toContain("your brand only");
    expect(rec.note).toContain("Beacon Uptime");
  });

  it("self-hides pages-they-own — this capture's corpus rows never populated competitors_present", () => {
    // a real fact of this run (the corpus enrichment step didn't attribute any
    // page to a specific rival), not a fixture-conversion artifact — the Kestrel
    // dominant case below proves the non-null path still works when the data
    // is there, and assertCompareInvariants guards it generically either way.
    expect(c.pagesTheyOwn).toBeNull();
  });

  it("prominence duel is honest: co-appearances tallied, every line receipt-backed", () => {
    expect(c.prominence).not.toBeNull();
    expect(c.prominence!.coAppearances).toBe(4);
    expect(c.prominence!.namedFirst).toBe(2);
    expect(c.prominence!.namedFirst + c.prominence!.buried).toBeLessThanOrEqual(
      c.prominence!.coAppearances,
    );
    for (const l of c.prominence!.lines) {
      expect(l.count).toBeGreaterThan(0);
      expect(l.receipt?.kind).toBe("answer");
    }
  });

  it("surfaces the real conditional segments the smoke run mined (Beacon Uptime steers)", () => {
    expect(c.steers).not.toBeNull();
    expect(c.steers!.items.length).toBeGreaterThan(0);
    for (const s of c.steers!.items) {
      expect(s.segment.length).toBeGreaterThan(0);
      expect(s.reason.length).toBeGreaterThan(0);
      expect(s.receipt?.kind).toBe("answer");
    }
  });

  it("holds every compare invariant", () => {
    assertCompareInvariants(c);
  });
});

describe("buildRivalCompare — unknown rival is honest, not crashy", () => {
  const c = buildRivalCompare(fixtureInput(), "Nonexistent Corp");
  it("flags the rival as unknown and self-hides rival-only sections", () => {
    expect(c.rivalKnown).toBe(false);
    expect(c.steers).toBeNull();
    expect(c.pagesTheyOwn).toBeNull();
    // the grid still renders (every cell is 'you' or 'neither' — rival never appears)
    const favors = c.grid!.rows.flatMap((r) => r.cells.map((x) => x.favor));
    expect(favors).not.toContain("rival");
    expect(favors).not.toContain("both");
  });
});

/* ==================== dominant — inline Kestrel-shaped ======================= */
// SOV {Kestrel:40, Northwind:12, Circuit:8}; segments steer to Northwind (with markdown);
// an absent answer names Northwind; a Northwind-owned page Kestrel is absent from (and it
// decides q01·q03). Two co-appearance answers (Kestrel present + Northwind in
// other_brands) exercise the prominence duel: named-first once, buried once. This
// is the aggregation / self-exclude / markdown-strip path no fixture covers.
function kestrelInput(): CompareInput {
  return {
    brand: { name: "Kestrel", domain: "kestrel.example", aliases: ["Kestrel", "kestrel.example"], competitors: ["Northwind", "Circuit"] },
    scores: {
      overall: { answered: 48, recommended: 45, mentioned: 47 },
      share_of_voice: { Kestrel: 40, Northwind: 12, Circuit: 8 },
    },
    answers: [
      // scored + brand recommended + rival named via segment → cell "both"
      { id: "a1", qid: "q01", qtype: "category", engine: "chatgpt", ok: true, verdict: { brand_present: true, mention_type: "recommended", segments: [{ winner: "Northwind", segment: "large transfers", reason: "**higher** limits" }] } },
      // scored + brand recommended, no rival → cell "you"
      { id: "a2", qid: "q02", qtype: "category", engine: "claude", ok: true, verdict: { brand_present: true, mention_type: "recommended", other_brands: [] } },
      // scored + brand absent + rival named → cell "rival"
      { id: "a3", qid: "q03", qtype: "problem", engine: "gemini", ok: true, verdict: { brand_present: false, mention_type: "absent", other_brands: [{ name: "Northwind", why: "lower fees on large transfers" }] } },
      // scored + brand absent + only Circuit named → cell "neither" (for Northwind)
      { id: "a4", qid: "q04", qtype: "problem", engine: "perplexity", ok: true, verdict: { brand_present: false, mention_type: "absent", other_brands: [{ name: "Circuit", why: "checkout acceptance" }] } },
      // second distinct Northwind steer → steers has 2 segments
      { id: "a5", qid: "q05", qtype: "category", engine: "chatgpt", ok: true, verdict: { brand_present: true, mention_type: "recommended", segments: [{ winner: "**Northwind**", segment: "crypto holders", reason: "native crypto trading" }] } },
      // co-appearance: Kestrel present + Northwind in other_brands, named FIRST → prominence duel
      { id: "a6", qid: "q06", qtype: "comparison", engine: "claude", ok: true, verdict: { brand_present: true, mention_type: "listed", prominence: "first", other_brands: [{ name: "Northwind", why: "alternative for crypto" }] } },
      // co-appearance: Kestrel present + Northwind in other_brands, BURIED → prominence duel
      { id: "a7", qid: "q07", qtype: "comparison", engine: "gemini", ok: true, verdict: { brand_present: true, mention_type: "listed", prominence: "buried", other_brands: [{ name: "Northwind", why: "listed above Kestrel" }] } },
    ],
    corpus: [
      { id: "p1", url: "https://northwind.example/blog/best-transfers", final_url: "https://northwind.example/blog/best-transfers", title: "Best transfer apps", page_type: "brand_owned", cited_by: { chatgpt: 2, claude: 1 }, cited_for_qids: ["q03", "q01", "q03"], brand_present: false, competitors_present: ["Northwind"], opportunity: false },
      // a page where Kestrel IS present → excluded from "pages they own that you don't"
      { id: "p2", url: "https://nerdwallet.com/kestrel", final_url: "https://nerdwallet.com/kestrel", title: "Kestrel review", page_type: "review_platform", cited_by: { gemini: 1 }, cited_for_qids: [], brand_present: true, competitors_present: ["Northwind"], opportunity: false },
    ],
  };
}

describe("rivalOptions — Kestrel dominant", () => {
  const opts = rivalOptions(kestrelInput());
  it("ranks Northwind over Circuit and never lists Kestrel itself", () => {
    expect(opts.map((o) => o.name)).toEqual(["Northwind", "Circuit"]);
    expect(opts.find((o) => /kestrel/i.test(o.name))).toBeUndefined();
  });
});

describe("buildRivalCompare — Kestrel vs Northwind (dominant)", () => {
  const c = buildRivalCompare(kestrelInput(), "Northwind");

  it("classifies each cell against the rival: both / you / rival / neither", () => {
    const cellOf = (qid: string) =>
      c.grid!.rows.find((r) => r.qid === qid)!.cells.find((x) => x.favor !== null)!;
    expect(cellOf("q01").favor).toBe("both"); // recommended + Northwind via segment
    expect(cellOf("q02").favor).toBe("you"); // recommended, no Northwind
    expect(cellOf("q03").favor).toBe("rival"); // absent, Northwind named
    expect(cellOf("q04").favor).toBe("neither"); // absent, only Circuit named
  });

  it("counts SOV mentions (40 vs 12) and your 45 recommendations", () => {
    const mentions = c.counts!.find((x) => x.metric.startsWith("Mentions"))!;
    expect(mentions.you).toBe(40);
    expect(mentions.rival).toBe(12);
    const rec = c.counts!.find((x) => x.metric.startsWith("Recommended"))!;
    expect(rec.you).toBe(45);
    expect(rec.rival).toBe(1); // one scored answer names Northwind while Kestrel is absent
  });

  it("surfaces both distinct Northwind steers, markdown stripped", () => {
    expect(c.steers).not.toBeNull();
    expect(c.steers!.items.length).toBe(2);
    const segs = c.steers!.items.map((s) => s.segment).sort();
    expect(segs).toEqual(["crypto holders", "large transfers"]);
    for (const s of c.steers!.items) expect(s.reason.includes("*")).toBe(false);
  });

  it("lists only the Northwind-owned page Kestrel is absent from (Kestrel-present page excluded)", () => {
    expect(c.pagesTheyOwn!.pages.length).toBe(1);
    expect(c.pagesTheyOwn!.pages[0].host).toBe("northwind.example");
    expect(c.pagesTheyOwn!.pages[0].cited).toBe(3);
    expect(c.pagesTheyOwn!.pages[0].engines).toBe(2);
  });

  it("maps each rival page's cited_for_qids to a sorted, deduped decides list", () => {
    // source cited_for_qids ["q03","q01","q03"] → sorted + deduped
    expect(c.pagesTheyOwn!.pages[0].decides).toEqual(["q01", "q03"]);
  });

  it("prominence duel: co-appearances tallied by your placement, each with a receipt", () => {
    expect(c.prominence).not.toBeNull();
    // a6 + a7 name BOTH Kestrel and Northwind (other_brands); a1/a5 steer via segments
    // (not a co-appearance) and are excluded.
    expect(c.prominence!.coAppearances).toBe(2);
    expect(c.prominence!.namedFirst).toBe(1);
    expect(c.prominence!.buried).toBe(1);
    const first = c.prominence!.lines.find((l) => l.key === "first")!;
    const buried = c.prominence!.lines.find((l) => l.key === "buried")!;
    expect(first.count).toBe(1);
    expect(buried.count).toBe(1);
    expect(first.receipt?.id).toBe("a6");
    expect(buried.receipt?.id).toBe("a7");
    // the empty "early" bucket is omitted, never rendered as a zero
    expect(c.prominence!.lines.find((l) => l.key === "early")).toBeUndefined();
  });

  it("holds every compare invariant (no markdown leaks from the segment winners)", () => {
    assertCompareInvariants(c);
  });
});
