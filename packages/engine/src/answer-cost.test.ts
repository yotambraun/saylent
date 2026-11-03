// Pins the per-answer cost math to the one rate table (rates.ts): the derived
// per-engine rates, the measured-usage formula, the !ok => 0 rule, the
// missing-usage fallback, and the honest formatter. Pure; $0.
import { describe, expect, it } from "vitest";
import {
  answerCents,
  COST_CENTS,
  formatCents,
  hasRecordedUsage,
  RATES,
} from "./answer-cost";
import { MODEL_RATES, TYPICAL_ANSWER_USAGE, callCents } from "./rates";

describe("answer-cost reads rates.ts", () => {
  it("each engine is priced at its default answer model plus its search fee", () => {
    expect(RATES.chatgpt).toEqual({ inPerM: 200, outPerM: 1000, searchCents: 1 }); // gpt-6.1-sol
    expect(RATES.claude).toEqual({ inPerM: 200, outPerM: 1000, searchCents: 1 }); // claude-sonnet-5-5
    expect(RATES.gemini).toEqual({ inPerM: 150, outPerM: 750, searchCents: 0 }); // gemini-3.6-flash
    expect(RATES.perplexity).toEqual({ inPerM: 100, outPerM: 100, searchCents: 1 }); // sonar
  });
  it("the fallback per answer is a typical answer at that rate", () => {
    for (const e of ["chatgpt", "claude", "gemini", "perplexity"] as const) {
      expect(COST_CENTS[e]).toBeCloseTo(callCents(RATES[e], TYPICAL_ANSWER_USAGE[e], RATES[e].searchCents), 10);
    }
  });
  it("prices measured usage at the model the run used when the table knows it", () => {
    const a = { engine: "chatgpt", ok: true, usage: { input_tokens: 1_000_000, output_tokens: 0, searches: 0 } };
    expect(answerCents(a)).toBeCloseTo(MODEL_RATES["gpt-6.1-sol"].inPerM, 10);
    expect(answerCents(a, "gpt-5.4")).toBeCloseTo(MODEL_RATES["gpt-5.4"].inPerM, 10);
    // an id the table does not know falls back to the engine's default rate, never 0
    expect(answerCents(a, "some-future-model")).toBeCloseTo(MODEL_RATES["gpt-6.1-sol"].inPerM, 10);
  });
});

describe("hasRecordedUsage", () => {
  it("is false for null / empty / tokenless usage", () => {
    expect(hasRecordedUsage(null)).toBe(false);
    expect(hasRecordedUsage(undefined)).toBe(false);
    expect(hasRecordedUsage({})).toBe(false);
    expect(hasRecordedUsage({ searches: 2 })).toBe(false);
  });
  it("is true once real tokens are present", () => {
    expect(hasRecordedUsage({ input_tokens: 10 })).toBe(true);
    expect(hasRecordedUsage({ output_tokens: 5 })).toBe(true);
  });
});

describe("answerCents", () => {
  it("computes from measured usage with the exact formula", () => {
    // fixture-shaped claude answer: 18254 in / 1010 out / 1 search
    const cents = answerCents({
      engine: "claude",
      ok: true,
      usage: { input_tokens: 18254, output_tokens: 1010, searches: 1 },
    });
    // claude-sonnet-5-5: 18254*200/1e6 + 1010*1000/1e6 + 1*1 = 3.6508 + 1.01 + 1 = 5.6608
    expect(cents).toBeCloseTo(5.6608, 4);
  });
  it("is 0 for a failed answer even with usage", () => {
    expect(
      answerCents({ engine: "chatgpt", ok: false, usage: { input_tokens: 999 } }),
    ).toBe(0);
  });
  it("falls back to the flat cost map when usage is missing", () => {
    expect(answerCents({ engine: "chatgpt", ok: true, usage: null })).toBe(COST_CENTS.chatgpt);
    expect(answerCents({ engine: "perplexity", ok: true })).toBe(COST_CENTS.perplexity);
  });
  it("never invents a price for an unknown engine", () => {
    expect(answerCents({ engine: "mistral", ok: true, usage: { input_tokens: 100 } })).toBe(0);
  });
});

describe("formatCents", () => {
  it("renders honest dollar strings", () => {
    expect(formatCents(7.9912)).toBe("$0.08");
    expect(formatCents(0.4)).toBe("< $0.01");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(104)).toBe("$1.04");
  });
});
