// CI guard for the public judge golden set (fixtures/golden-judge.json v2).
// The gate itself costs money, so this test guards everything about the file
// that can be checked for free: it covers the whole source bundle, every label
// uses the judge's own enums, every judgeable answer carries non-empty text that
// is byte-identical to fixtures/golden-judge-source.json (the frozen labeled run; the public sample
// run and the labels made against it), and no real brand from the retired
// private v1 set leaks in.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type GoldenLabel,
  judgeableLabels,
  loadGolden,
  otherBrandsAgree,
} from "./judge-golden";

const MENTIONS = ["recommended", "listed", "compared", "neutral", "dismissed", "absent"];
const PROMINENCE = ["first", "early", "buried", "none"];
const SENTIMENT = ["positive", "neutral", "negative"];

const fx = loadGolden();
const bundle = JSON.parse(readFileSync("fixtures/golden-judge-source.json", "utf8")) as {
  answers: { qid: string; engine: string; ok: boolean; raw_text: string }[];
};

const key = (l: { qid: string; engine: string }) => `${l.qid}/${l.engine}`;

describe("fixtures/golden-judge.json", () => {
  it("covers every answer of the source bundle, once", () => {
    expect(fx.labels).toHaveLength(24);
    expect(fx.labels.map(key).sort()).toEqual(bundle.answers.map(key).sort());
    expect(new Set(fx.labels.map(key)).size).toBe(24);
  });

  it("carries the brand model the judge prompt needs", () => {
    expect(fx.brand_model.brand).toBe("Kestrel Uptime");
    expect(fx.brand_model.aliases.length).toBeGreaterThan(0);
    expect(Array.isArray(fx.brand_model.competitors)).toBe(true);
  });

  it("labels every judgeable answer and only those", () => {
    const judgeable = judgeableLabels(fx);
    expect(judgeable).toHaveLength(18);
    for (const l of fx.labels) {
      const src = bundle.answers.find((a) => key(a) === key(l));
      expect(src, `no bundle answer for ${key(l)}`).toBeDefined();
      expect(l.judgeable !== false).toBe(src?.ok);
      if (src?.ok) expect(l.ref, `${key(l)} must be labeled`).toBeDefined();
      else {
        expect(l.ref).toBeUndefined();
        expect(l.engine_error, `${key(l)} must record why it failed`).toBeTruthy();
      }
    }
  });

  it("inlines the raw answer text verbatim from the bundle", () => {
    for (const l of judgeableLabels(fx)) {
      const src = bundle.answers.find((a) => key(a) === key(l)) as unknown as {
        raw_text: string;
        question: string;
      };
      expect(l.answer.length, `${key(l)} answer must be non-empty`).toBeGreaterThan(0);
      expect(l.answer, `${key(l)} answer drifted from the bundle`).toBe(src.raw_text);
      expect(l.question, `${key(l)} question drifted from the bundle`).toBe(src.question);
    }
  });

  it("uses only the judge's enum values, with reasoning on every label", () => {
    for (const l of judgeableLabels(fx)) {
      const ref = l.ref as NonNullable<GoldenLabel["ref"]>;
      expect(MENTIONS, key(l)).toContain(ref.mention_type);
      expect(PROMINENCE, key(l)).toContain(ref.prominence);
      expect(SENTIMENT, key(l)).toContain(ref.sentiment);
      expect(l.reasoning, `${key(l)} needs written reasoning`).toBeTruthy();
      if (ref.entity_confusion !== undefined) expect(ref.entity_confusion).toBe(true);
      if (ref.other_brands) {
        expect(Array.isArray(ref.other_brands)).toBe(true);
        for (const b of ref.other_brands) expect(b.trim().length).toBeGreaterThan(0);
      }
      // deterministic absence is code-enforced: absent implies prominence none
      if (ref.mention_type === "absent") expect(ref.prominence).toBe("none");
    }
  });

  it("keeps the R1-R6 rubric lines judge.ts cites", () => {
    const rules = (fx._meta as { rubric_rules_derived?: string[] }).rubric_rules_derived ?? [];
    expect(rules).toHaveLength(6);
    for (const [i, r] of rules.entries()) expect(r.startsWith(`R${i + 1} `)).toBe(true);
  });

  it("names no company from the retired private v1 set", () => {
    // v1 labeled answers about five real companies; v2 must not carry them.
    // Generic issue-tracker names are NOT banned: two engines answered the (deliberately
    // unanswerable) q10 with an issue-tracker comparison, and the pseudonymizer
    // leaves incidental real tools real — see examples/kestrel/README.md.
    const banned = /\b(clerk|resend|railway|posthog|better ?stack|pingdom|uptimerobot)\b/i;
    expect(banned.test(JSON.stringify(fx))).toBe(false);
  });
});

describe("otherBrandsAgree", () => {
  it("is a recall check, case- and suffix-tolerant", () => {
    expect(otherBrandsAgree(["Beacon Uptime"], ["Beacon Uptime (Beacon Live)"])).toBe(true);
    expect(otherBrandsAgree(["upcheck"], ["Upcheck", "Statusly"])).toBe(true);
    expect(otherBrandsAgree(["Upcheck", "Statusly"], ["Upcheck"])).toBe(false);
  });

  it("demands an empty list when the reference is empty", () => {
    expect(otherBrandsAgree([], [])).toBe(true);
    expect(otherBrandsAgree([], ["Upcheck"])).toBe(false);
  });
});
