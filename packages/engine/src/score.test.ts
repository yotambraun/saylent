// Adaptive sampling (migration 0033) — majority vote + confidence band + adaptive
// tiebreak-decision unit tests.
import { describe, expect, it } from "vitest";
import {
  computeScores,
  type Draw,
  needsTiebreak,
  recommendedBand,
  type SampleMention,
  voteAnswer,
  voteMentionType,
} from "./score";
import type { AnswerRow, Engine, Verdict } from "./types";

type Mention = Verdict["mention_type"];

function verdict(mention_type: Mention): Verdict {
  return {
    brand_present: mention_type !== "absent",
    mention_type,
    prominence: mention_type === "absent" ? "none" : "early",
    sentiment: "neutral",
    claims: [],
    other_brands: [],
    excerpt: "",
  };
}

function draw(
  sampleIdx: number,
  mention: Mention | null,
  extra: Partial<Draw> = {},
): Draw {
  const ok = extra.ok ?? mention !== null;
  return {
    qid: "q01",
    qtype: "category",
    question: "best X?",
    engine: "chatgpt",
    sampleIdx,
    ok,
    raw_text: `raw-${sampleIdx}`,
    citations: [],
    ...(mention ? { verdict: verdict(mention) } : {}),
    ...extra,
  };
}

describe("voteMentionType", () => {
  it("returns null for no draws", () => {
    expect(voteMentionType([])).toBeNull();
  });
  it("returns the single draw's mention", () => {
    expect(voteMentionType(["recommended"])).toBe("recommended");
  });
  it("takes the strict majority (2 of 3)", () => {
    expect(voteMentionType(["recommended", "recommended", "neutral"])).toBe("recommended");
    expect(voteMentionType(["absent", "neutral", "neutral"])).toBe("neutral");
  });
  it("all three differ → middle by strength ordering (rec > listed=compared > neutral > absent)", () => {
    // strengths rec0, listed1, neutral2 → middle = listed
    expect(voteMentionType(["recommended", "listed", "neutral"])).toBe("listed");
    // listed1, compared1, neutral2 → sorted [listed, compared, neutral] → middle compared
    expect(voteMentionType(["listed", "compared", "neutral"])).toBe("compared");
    // rec0, listed1, compared1 → sorted [rec, listed, compared] → middle listed
    expect(voteMentionType(["recommended", "compared", "listed"])).toBe("listed");
  });
  it("even (2-draw) tie rounds toward the weaker (conservative)", () => {
    // one draw failed → 2 ok draws differ → sorted [rec(0), neutral(2)] → idx1 = neutral
    expect(voteMentionType(["recommended", "neutral"])).toBe("neutral");
  });
});

describe("needsTiebreak (adaptive sampling decision)", () => {
  it("agree-pair (two ok draws, same mention) → NO tiebreak", () => {
    expect(needsTiebreak([draw(0, "recommended"), draw(1, "recommended")])).toBe(false);
    expect(needsTiebreak([draw(0, "neutral"), draw(1, "neutral")])).toBe(false);
  });
  it("disagree-pair (two ok draws, different mentions) → tiebreak fires", () => {
    expect(needsTiebreak([draw(0, "recommended"), draw(1, "neutral")])).toBe(true);
    expect(needsTiebreak([draw(0, "listed"), draw(1, "absent")])).toBe(true);
  });
  it("one failed draw → tiebreak fires (a failed draw can't decide the vote)", () => {
    expect(needsTiebreak([draw(0, "recommended"), draw(1, null, { ok: false })])).toBe(true);
  });
  it("both failed → tiebreak fires (a fresh draw may recover an answer)", () => {
    expect(
      needsTiebreak([draw(0, null, { ok: false }), draw(1, null, { ok: false })]),
    ).toBe(true);
  });
});

describe("voteAnswer", () => {
  it("2 AGREEING draws (adaptive, no tiebreak) → mode is the vote, representative = draw 0", () => {
    const { canonical, representativeIdx } = voteAnswer([
      draw(0, "recommended", { raw_text: "r0" }),
      draw(1, "recommended", { raw_text: "r1" }),
    ]);
    expect(canonical.verdict?.mention_type).toBe("recommended");
    expect(representativeIdx).toBe(0); // first (and matching) ok draw
    expect(canonical.raw_text).toBe("r0");
    expect(canonical.ok).toBe(true);
  });

  it("majority vote; representative is the first ok draw matching the vote", () => {
    const { canonical, representativeIdx } = voteAnswer([
      draw(0, "neutral", { raw_text: "r0" }),
      draw(1, "recommended", { raw_text: "r1" }),
      draw(2, "recommended", { raw_text: "r2" }),
    ]);
    expect(canonical.verdict?.mention_type).toBe("recommended");
    expect(representativeIdx).toBe(1); // first recommended draw
    expect(canonical.raw_text).toBe("r1"); // representative's raw_text wins
    expect(canonical.ok).toBe(true);
  });

  it("pins the canonical verdict's mention_type to the vote", () => {
    const { canonical } = voteAnswer([
      draw(0, "recommended"),
      draw(1, "neutral"),
      draw(2, "recommended"),
    ]);
    expect(canonical.verdict?.mention_type).toBe("recommended");
  });

  it("sums usage across ALL draws (cost truth)", () => {
    const { canonical } = voteAnswer([
      draw(0, "recommended", { usage: { input_tokens: 100, output_tokens: 50, searches: 1 } }),
      draw(1, "neutral", { usage: { input_tokens: 200, output_tokens: 60, searches: 2 } }),
      draw(2, "recommended", { usage: { input_tokens: 300, output_tokens: 70 } }),
    ]);
    expect(canonical.usage).toEqual({ input_tokens: 600, output_tokens: 180, searches: 3 });
  });

  it("single draw (non-scored) → that draw is canonical", () => {
    const { canonical, representativeIdx } = voteAnswer([draw(0, "listed", { raw_text: "solo" })]);
    expect(representativeIdx).toBe(0);
    expect(canonical.raw_text).toBe("solo");
    expect(canonical.verdict?.mention_type).toBe("listed");
  });

  it("all draws failed → canonical is the failed draw 0, unjudged, usage summed", () => {
    const { canonical, representativeIdx } = voteAnswer([
      draw(0, null, { ok: false, raw_text: "", error: "timeout", usage: { input_tokens: 10 } }),
      draw(1, null, { ok: false, raw_text: "", error: "timeout" }),
    ]);
    expect(representativeIdx).toBeNull();
    expect(canonical.ok).toBe(false);
    expect(canonical.verdict).toBeUndefined();
    expect(canonical.usage).toEqual({ input_tokens: 10, output_tokens: 0, searches: 0 });
  });
});

describe("recommendedBand", () => {
  const chatgpt: Engine = "chatgpt";
  it("min/max recommended over the sample-sets", () => {
    const canonical = [{ qid: "q01", engine: chatgpt, mention_type: "recommended" as Mention }];
    const samples: SampleMention[] = [
      { qid: "q01", engine: chatgpt, sampleIdx: 0, mention_type: "recommended" },
      { qid: "q01", engine: chatgpt, sampleIdx: 1, mention_type: "neutral" },
      { qid: "q01", engine: chatgpt, sampleIdx: 2, mention_type: "recommended" },
    ];
    const band = recommendedBand(canonical, samples);
    expect(band.overall).toEqual({ min: 0, max: 1 });
    expect(band.per_engine.chatgpt).toEqual({ min: 0, max: 1 });
    expect(band.per_engine.claude).toEqual({ min: 0, max: 0 });
  });

  it("no samples → point estimate (min == max == recommended count)", () => {
    const canonical = [
      { qid: "q01", engine: chatgpt, mention_type: "recommended" as Mention },
      { qid: "q02", engine: chatgpt, mention_type: "neutral" as Mention },
    ];
    const band = recommendedBand(canonical, []);
    expect(band.overall).toEqual({ min: 1, max: 1 });
  });

  it("a scored answer with no per-set draw falls back to its canonical mention", () => {
    // q02 has NO samples → uses canonical (recommended) in every set; q01 varies.
    const canonical = [
      { qid: "q01", engine: chatgpt, mention_type: "neutral" as Mention },
      { qid: "q02", engine: chatgpt, mention_type: "recommended" as Mention },
    ];
    const samples: SampleMention[] = [
      { qid: "q01", engine: chatgpt, sampleIdx: 0, mention_type: "recommended" },
      { qid: "q01", engine: chatgpt, sampleIdx: 1, mention_type: "neutral" },
    ];
    // set0: q01 rec + q02 rec = 2; set1: q01 neutral + q02 rec = 1
    const band = recommendedBand(canonical, samples);
    expect(band.overall).toEqual({ min: 1, max: 2 });
  });

  it("ALL agreeing pairs (adaptive, no tiebreak) → 2 sets → tight/degenerate band", () => {
    // Both scored groups are agreeing 2-draw pairs → max sampleIdx 1 → nSets 2.
    const canonical = [
      { qid: "q01", engine: chatgpt, mention_type: "recommended" as Mention },
      { qid: "q02", engine: chatgpt, mention_type: "neutral" as Mention },
    ];
    const samples: SampleMention[] = [
      { qid: "q01", engine: chatgpt, sampleIdx: 0, mention_type: "recommended" },
      { qid: "q01", engine: chatgpt, sampleIdx: 1, mention_type: "recommended" },
      { qid: "q02", engine: chatgpt, sampleIdx: 0, mention_type: "neutral" },
      { qid: "q02", engine: chatgpt, sampleIdx: 1, mention_type: "neutral" },
    ];
    // set0: rec + neutral = 1; set1: rec + neutral = 1 → min == max (stable).
    const band = recommendedBand(canonical, samples);
    expect(band.overall).toEqual({ min: 1, max: 1 });
    expect(band.per_engine.chatgpt).toEqual({ min: 1, max: 1 });
  });

  it("MIXED 2/3 sets: an agreeing pair falls back to canonical in set 2, only the tiebroken triple spans", () => {
    // q01 = agreeing pair (2 draws, both recommended). q02 = tiebroken triple
    // (rec, neutral, rec → voted recommended). One tiebreak anywhere ⇒ nSets 3.
    const canonical = [
      { qid: "q01", engine: chatgpt, mention_type: "recommended" as Mention },
      { qid: "q02", engine: chatgpt, mention_type: "recommended" as Mention },
    ];
    const samples: SampleMention[] = [
      { qid: "q01", engine: chatgpt, sampleIdx: 0, mention_type: "recommended" },
      { qid: "q01", engine: chatgpt, sampleIdx: 1, mention_type: "recommended" },
      { qid: "q02", engine: chatgpt, sampleIdx: 0, mention_type: "recommended" },
      { qid: "q02", engine: chatgpt, sampleIdx: 1, mention_type: "neutral" },
      { qid: "q02", engine: chatgpt, sampleIdx: 2, mention_type: "recommended" },
    ];
    // set0: q01 rec + q02 rec = 2; set1: q01 rec + q02 neutral = 1;
    // set2: q01 NO draw → canonical rec + q02 rec = 2 → band {min 1, max 2}.
    const band = recommendedBand(canonical, samples);
    expect(band.overall).toEqual({ min: 1, max: 2 });
  });
});

describe("computeScores attaches recommended_band", () => {
  function answer(qid: string, mention: Mention): AnswerRow {
    return {
      qid,
      qtype: "category",
      question: "q?",
      engine: "chatgpt",
      ok: true,
      raw_text: "",
      citations: [],
      verdict: verdict(mention),
    };
  }
  it("point band when no samples are supplied", () => {
    const scores = computeScores([answer("q01", "recommended"), answer("q02", "neutral")]);
    expect(scores.recommended_band?.overall).toEqual({ min: 1, max: 1 });
    expect(scores.overall.recommended).toBe(1);
  });
  it("widens when samples disagree", () => {
    const samples: SampleMention[] = [
      { qid: "q01", engine: "chatgpt", sampleIdx: 0, mention_type: "recommended" },
      { qid: "q01", engine: "chatgpt", sampleIdx: 1, mention_type: "neutral" },
      { qid: "q01", engine: "chatgpt", sampleIdx: 2, mention_type: "recommended" },
    ];
    const scores = computeScores([answer("q01", "recommended")], samples);
    expect(scores.recommended_band?.overall).toEqual({ min: 0, max: 1 });
  });
});
