// Pins the per-answer cost math to the engine's billing (src/inngest/functions.ts
// answerCents): rate table parity, the measured-usage formula, the !ok ⇒ 0 rule,
// the missing-usage fallback, and the honest formatter. Pure; $0.
import { describe, expect, it } from "vitest";
import {
  answerCents,
  COST_CENTS,
  formatCents,
  hasRecordedUsage,
  RATES,
} from "./answer-cost";

describe("answer-cost — parity with src/inngest/functions.ts RATES/COST_CENTS", () => {
  it("keeps the verified provider rates", () => {
    expect(RATES.chatgpt).toEqual({ inPerM: 125, outPerM: 1000, searchCents: 1 });
    expect(RATES.claude).toEqual({ inPerM: 300, outPerM: 1500, searchCents: 1 });
    expect(RATES.gemini).toEqual({ inPerM: 150, outPerM: 750, searchCents: 0 });
    expect(RATES.perplexity).toEqual({ inPerM: 100, outPerM: 100, searchCents: 1 });
  });
  it("keeps the fallback cost map", () => {
    expect(COST_CENTS).toEqual({ chatgpt: 3, claude: 4, gemini: 1.3, perplexity: 1.5 });
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
    // 18254*300/1e6 + 1010*1500/1e6 + 1*1 = 5.4762 + 1.515 + 1 = 7.9912
    expect(cents).toBeCloseTo(7.9912, 4);
  });
  it("is 0 for a failed answer even with usage", () => {
    expect(
      answerCents({ engine: "chatgpt", ok: false, usage: { input_tokens: 999 } }),
    ).toBe(0);
  });
  it("falls back to the flat cost map when usage is missing", () => {
    expect(answerCents({ engine: "chatgpt", ok: true, usage: null })).toBe(3);
    expect(answerCents({ engine: "perplexity", ok: true })).toBe(1.5);
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
