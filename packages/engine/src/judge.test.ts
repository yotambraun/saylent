// Judge verdict extractions (see METHODOLOGY.md). Covers the NEW verdict extractions
// (segments / pricing_claims / entity_confusion) on buildVerdict, and the
// judgeOne { verdict, parsed } contract with ONE retry + neutral fallback.
// (The malformed-output degradation + E2a claims/other_brands cases live in
// engine.test.ts and still pass — buildVerdict only ADDS optional fields.)
import { describe, expect, it } from "vitest";
import { type JudgeCaller, buildVerdict, judgeFamilyFor, judgeOne } from "./judge";
import { resolveRoles } from "./models";
import type { AnswerRow, BrandModel, Engine } from "./types";

const bm: BrandModel = {
  brand: "Acme",
  domain: "acme.com",
  aliases: ["Acme", "acme"],
  category: "CDN",
  icp: "SaaS teams",
  products: [],
  value_props: ["fast"],
  problems: [],
  competitors: ["Rival"],
  language: "en",
};

const answer = (text: string): AnswerRow => ({
  qid: "q01",
  qtype: "category",
  question: "best CDN?",
  engine: "chatgpt",
  ok: true,
  raw_text: text,
  citations: [],
});

describe("buildVerdict extended extractions", () => {
  it("extracts segments / pricing_claims / entity_confusion when present, dropping junk", () => {
    const v = buildVerdict(answer("Acme is fine."), bm, {
      mention_type: "recommended",
      segments: [
        { segment: "React teams", winner: "Acme", reason: "fastest setup" },
        { segment: "", winner: "X" }, // dropped: no segment
        { winner: "Y", reason: "z" }, // dropped: no segment/winner pair
      ],
      pricing_claims: ["Starts at $10/mo", "   ", "Free tier"], // blank dropped
      entity_confusion: true,
    });
    expect(v.segments).toEqual([{ segment: "React teams", winner: "Acme", reason: "fastest setup" }]);
    expect(v.pricing_claims).toEqual(["Starts at $10/mo", "Free tier"]);
    expect(v.entity_confusion).toBe(true);
  });

  it("caps segments at 4 and pricing_claims at 3", () => {
    const v = buildVerdict(answer("Acme is fine."), bm, {
      mention_type: "listed",
      segments: Array.from({ length: 6 }, (_, i) => ({ segment: `s${i}`, winner: "Acme", reason: "" })),
      pricing_claims: Array.from({ length: 5 }, (_, i) => `$${i}/mo`),
    });
    expect(v.segments).toHaveLength(4);
    expect(v.pricing_claims).toHaveLength(3);
  });

  it("leaves the extra extraction fields ABSENT when the judge omits them (old rows stay lean)", () => {
    const v = buildVerdict(answer("Acme is fine."), bm, { mention_type: "listed" });
    expect(v.segments).toBeUndefined();
    expect(v.pricing_claims).toBeUndefined();
    expect(v.entity_confusion).toBeUndefined();
  });

  it("attaches entity_confusion only when strictly true", () => {
    const v = buildVerdict(answer("Acme is fine."), bm, { mention_type: "listed", entity_confusion: "yes" });
    expect(v.entity_confusion).toBeUndefined();
  });
});

describe("judgeOne { verdict, parsed } contract + retry", () => {
  const jsonOK = JSON.stringify({ mention_type: "recommended", prominence: "first", sentiment: "positive" });

  it("parsed:true and verdict from JSON on a clean call", async () => {
    const stub: JudgeCaller = async () => jsonOK;
    const { verdict, parsed } = await judgeOne(answer("Acme is great."), bm, stub);
    expect(parsed).toBe(true);
    expect(verdict.mention_type).toBe("recommended");
  });

  it("retries ONCE on transport failure, then succeeds (parsed:true)", async () => {
    let n = 0;
    const stub: JudgeCaller = async () => (++n === 1 ? null : jsonOK);
    const { verdict, parsed } = await judgeOne(answer("Acme is great."), bm, stub);
    expect(n).toBe(2);
    expect(parsed).toBe(true);
    expect(verdict.mention_type).toBe("recommended");
  });

  it("parsed:false + neutral FALLBACK shape after both attempts fail (present brand)", async () => {
    let n = 0;
    const stub: JudgeCaller = async () => {
      n++;
      return null;
    };
    const { verdict, parsed } = await judgeOne(answer("Acme is present here."), bm, stub);
    expect(n).toBe(2); // one call + exactly one retry
    expect(parsed).toBe(false);
    // The fallback shape run-health's isJudgeFallback() detects for a present brand.
    expect(verdict.brand_present).toBe(true);
    expect(verdict.mention_type).toBe("neutral");
    expect(verdict.prominence).toBe("buried");
    expect(verdict.sentiment).toBe("neutral");
    expect(verdict.claims).toEqual([]);
    expect(verdict.other_brands).toEqual([]);
  });

  it("unparseable output also triggers the retry, then fallback (parsed:false)", async () => {
    let n = 0;
    const stub: JudgeCaller = async () => {
      n++;
      return "not json at all";
    };
    const { parsed } = await judgeOne(answer("Acme here."), bm, stub);
    expect(n).toBe(2);
    expect(parsed).toBe(false);
  });

  it("a thrown transport error is caught and retried (never propagates)", async () => {
    let n = 0;
    const stub: JudgeCaller = async () => {
      n++;
      if (n === 1) throw new Error("network");
      return jsonOK;
    };
    const { parsed } = await judgeOne(answer("Acme is great."), bm, stub);
    expect(n).toBe(2);
    expect(parsed).toBe(true);
  });
});

// SINGLE-PROVIDER MODE: the judge family is now a
// function of the run's resolved roles. Cross-family routing is unchanged; with
// one key every engine is judged by the one family that has a key.
describe("judge family routing", () => {
  const engines: Engine[] = ["chatgpt", "gemini", "claude", "perplexity"];

  it("two keys: the cross-family map (chatgpt,gemini -> anthropic; claude,perplexity -> openai)", () => {
    const roles = resolveRoles({ openai: true, anthropic: true });
    expect(engines.map((e) => judgeFamilyFor(e, roles))).toEqual([
      "anthropic",
      "anthropic",
      "openai",
      "openai",
    ]);
  });

  it("OpenAI only: every engine is judged by OpenAI", () => {
    const roles = resolveRoles({ openai: true });
    expect(engines.map((e) => judgeFamilyFor(e, roles))).toEqual([
      "openai",
      "openai",
      "openai",
      "openai",
    ]);
  });

  it("Anthropic only: every engine is judged by Anthropic", () => {
    const roles = resolveRoles({ anthropic: true });
    expect(engines.map((e) => judgeFamilyFor(e, roles))).toEqual([
      "anthropic",
      "anthropic",
      "anthropic",
      "anthropic",
    ]);
  });

  it("judgeOne calls the transport with the family its roles assign", async () => {
    const seen: string[] = [];
    const caller: JudgeCaller = async (family) => {
      seen.push(family);
      return JSON.stringify({ mention_type: "listed", prominence: "early", sentiment: "neutral" });
    };
    // a chatgpt answer is judged by anthropic when both keys exist ...
    await judgeOne(answer("Acme is listed."), bm, caller, resolveRoles({ openai: true, anthropic: true }));
    // ... and by openai when that is the only family available
    await judgeOne(answer("Acme is listed."), bm, caller, resolveRoles({ openai: true }));
    expect(seen).toEqual(["anthropic", "openai"]);
  });

  it("single-family judging leaves the verdict rules untouched (deterministic absence still wins)", async () => {
    const caller: JudgeCaller = async () =>
      JSON.stringify({ mention_type: "recommended", prominence: "first", sentiment: "positive" });
    const { verdict } = await judgeOne(
      answer("Globex and Initech are the options."),
      bm,
      caller,
      resolveRoles({ anthropic: true }),
    );
    expect(verdict.brand_present).toBe(false);
    expect(verdict.mention_type).toBe("absent");
    expect(verdict.prominence).toBe("none");
  });
});
