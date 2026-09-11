import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// STATIC import, not the dynamic engine-loader — see run.test.ts's note: a
// dynamic import() of @saylent/engine was measured to hang/time out under
// vitest, worse (and more variably) under the full suite's contention than
// in isolation. A static import is unaffected and this module only needs
// types/constants (PROFILES, COST_CENTS, ROLE_COST_CENTS), never the network.
import * as engineMod from "@saylent/engine";
import {
  checkSpendCap,
  confirmRun,
  NOT_A_TERMINAL_MESSAGE,
  NotATerminalError,
  DEFAULT_DAILY_CAP_USD,
  estimateCostRange,
  formatCostRange,
  formatJudgeMode,
  formatJudgeModels,
  formatSamplingLine,
  formatSkipLine,
  parseSamplesFlag,
  recordSpend,
  spendFilePath,
  todaySpendUsd,
} from "./preflight";

let home: string;
let prevHome: string | undefined;
let prevCap: string | undefined;

beforeEach(() => {
  prevHome = process.env.HOME;
  prevCap = process.env.DAILY_SPEND_CAP_USD;
  home = mkdtempSync(path.join(tmpdir(), "saylent-preflight-"));
  process.env.HOME = home;
  delete process.env.DAILY_SPEND_CAP_USD;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  process.env.HOME = prevHome;
  if (prevCap === undefined) delete process.env.DAILY_SPEND_CAP_USD;
  else process.env.DAILY_SPEND_CAP_USD = prevCap;
});

describe("estimateCostRange (matches answer-cost.ts inputs)", () => {
  it("returns a non-negative low <= high range for smoke/2 engines", () => {
    const range = estimateCostRange(engineMod, "smoke", ["chatgpt", "claude"]);
    expect(range.lowUsd).toBeGreaterThanOrEqual(0);
    expect(range.highUsd).toBeGreaterThanOrEqual(range.lowUsd);
  });

  it("full costs more than smoke for the same engines", () => {
    const smoke = estimateCostRange(engineMod, "smoke", ["chatgpt", "claude"]);
    const full = estimateCostRange(engineMod, "full", ["chatgpt", "claude"]);
    expect(full.highUsd).toBeGreaterThan(smoke.highUsd);
  });

  it("more engines costs more than fewer, same profile", () => {
    const two = estimateCostRange(engineMod, "smoke", ["chatgpt", "claude"]);
    const four = estimateCostRange(engineMod, "smoke", ["chatgpt", "claude", "gemini", "perplexity"]);
    expect(four.highUsd).toBeGreaterThan(two.highUsd);
  });

  it("formatCostRange prints a dollar range", () => {
    expect(formatCostRange({ lowUsd: 0.4, highUsd: 0.7 })).toBe("$0.40–$0.70");
    expect(formatCostRange({ lowUsd: 0, highUsd: 0.005 })).toBe("< $0.01–< $0.01");
  });

  // Samples feature: the estimate scales with the resolved
  // run-level sample count/tiebreak, not just the fixed profile default.
  it("a higher resolved samples count raises the estimate over the profile default", () => {
    const base = estimateCostRange(engineMod, "full", ["chatgpt", "claude"]);
    const bumped = estimateCostRange(engineMod, "full", ["chatgpt", "claude"], {
      sampling: { samples: 5, tiebreak: false },
    });
    expect(bumped.highUsd).toBeGreaterThan(base.highUsd);
  });

  it("--samples 1 lowers the estimate below the full-profile default (2)", () => {
    const base = estimateCostRange(engineMod, "full", ["chatgpt", "claude"]);
    const lowered = estimateCostRange(engineMod, "full", ["chatgpt", "claude"], {
      sampling: { samples: 1, tiebreak: false },
    });
    expect(lowered.highUsd).toBeLessThan(base.highUsd);
  });

  it("a --questions file's row count (add/remove) is reflected in the estimate", () => {
    const base = estimateCostRange(engineMod, "smoke", ["chatgpt"]);
    const fewer = estimateCostRange(engineMod, "smoke", ["chatgpt"], {
      questions: [{ qtype: "category" }, { qtype: "branded" }], // 2 rows, well under smoke's 6
    });
    expect(fewer.highUsd).toBeLessThan(base.highUsd);
  });

  // skip.drafts drops the drafter overhead.
  it("skip.drafts lowers the high estimate (the drafter overhead is dropped)", () => {
    const base = estimateCostRange(engineMod, "full", ["chatgpt", "claude"]);
    const skipped = estimateCostRange(engineMod, "full", ["chatgpt", "claude"], {
      skip: { drafts: true },
    });
    expect(skipped.highUsd).toBeLessThan(base.highUsd);
    expect(skipped.lowUsd).toBe(base.lowUsd); // the low estimate never counted drafter cost anyway
  });

  it("skip.drafts: false (or omitted) leaves the estimate unchanged", () => {
    const base = estimateCostRange(engineMod, "full", ["chatgpt", "claude"]);
    const explicit = estimateCostRange(engineMod, "full", ["chatgpt", "claude"], {
      skip: { drafts: false },
    });
    expect(explicit).toEqual(base);
  });
});

describe("formatSkipLine", () => {
  it("null when nothing is skipped", () => {
    expect(formatSkipLine({ drafts: false, corpus: false, gates: false })).toBeNull();
  });

  it("names the skipped stages, in drafts/corpus/gates order, regardless of input order", () => {
    expect(formatSkipLine({ drafts: false, corpus: true, gates: true })).toBe(
      "Skipping  corpus, gates (by request)",
    );
    expect(formatSkipLine({ drafts: true, corpus: false, gates: false })).toBe(
      "Skipping  drafts (by request)",
    );
  });
});

describe("parseSamplesFlag", () => {
  it("undefined when the flag wasn't passed", () => {
    expect(parseSamplesFlag(undefined)).toBeUndefined();
  });

  it("parses a valid 1-5 value", () => {
    expect(parseSamplesFlag("3")).toBe(3);
    expect(parseSamplesFlag("1")).toBe(1);
    expect(parseSamplesFlag("5")).toBe(5);
  });

  it("throws a clear error on an out-of-range or non-integer value", () => {
    expect(() => parseSamplesFlag("0")).toThrow(/--samples 0/);
    expect(() => parseSamplesFlag("6")).toThrow(/--samples 6/);
    expect(() => parseSamplesFlag("abc")).toThrow(/--samples abc/);
  });
});

describe("formatSamplingLine", () => {
  it("names the source and the tiebreak state at n=2", () => {
    expect(formatSamplingLine({ samples: 2, tiebreak: true, source: "profile" })).toBe(
      "2x scored questions (profile default) · tiebreak on disagreement (n=2)",
    );
    expect(formatSamplingLine({ samples: 2, tiebreak: false, source: "config" })).toBe(
      "2x scored questions (saylent.config sampling) · tiebreak off",
    );
  });

  it("carries no tiebreak clause outside n=2", () => {
    expect(formatSamplingLine({ samples: 1, tiebreak: false, source: "flag" })).toBe(
      "1x scored questions (--samples)",
    );
    expect(formatSamplingLine({ samples: 4, tiebreak: false, source: "env" })).toBe(
      "4x scored questions (AUDIT_SAMPLES)",
    );
  });
});

describe("spend ledger", () => {
  it("starts at $0 for today", () => {
    expect(todaySpendUsd()).toBe(0);
  });

  it("recordSpend accumulates across calls", () => {
    recordSpend(0.42);
    recordSpend(0.08);
    expect(todaySpendUsd()).toBeCloseTo(0.5, 5);
  });

  it("writes ~/.saylent/spend.json", () => {
    recordSpend(1.23);
    expect(spendFilePath()).toContain(home);
  });
});

describe("checkSpendCap", () => {
  it("passes under the default $20 cap", () => {
    const check = checkSpendCap(5);
    expect(check.ok).toBe(true);
  });

  it("refuses once today's spend + estimate would exceed the cap", () => {
    recordSpend(18);
    const check = checkSpendCap(5, { now: new Date() });
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/Daily spend cap/);
  });

  it("honors DAILY_SPEND_CAP_USD", () => {
    process.env.DAILY_SPEND_CAP_USD = "1";
    const check = checkSpendCap(2);
    expect(check.ok).toBe(false);
  });

  it("honors --max-usd even under the daily cap", () => {
    const check = checkSpendCap(3, { maxUsd: 2 });
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/--max-usd/);
  });

  it("DEFAULT_DAILY_CAP_USD is $20 — the same default the app's own spend cap uses", () => {
    expect(DEFAULT_DAILY_CAP_USD).toBe(20);
  });
});

describe("confirmRun", () => {
  function fakeIo(answer: string) {
    const input = new Readable({ read() {} });
    input.push(`${answer}\n`);
    input.push(null);
    const chunks: string[] = [];
    const output = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    return { input, output, written: () => chunks.join("") };
  }

  it("empty answer defaults to yes", async () => {
    const io = fakeIo("");
    await expect(confirmRun(io)).resolves.toBe(true);
  });

  it("'y'/'yes' resolve true, anything else false", async () => {
    await expect(confirmRun(fakeIo("y"))).resolves.toBe(true);
    await expect(confirmRun(fakeIo("yes"))).resolves.toBe(true);
    await expect(confirmRun(fakeIo("n"))).resolves.toBe(false);
    await expect(confirmRun(fakeIo("nope"))).resolves.toBe(false);
  });

  it("refuses instead of asking when there is no terminal to answer", async () => {
    // A piped/closed stdin resolves the question with an immediate EOF, which
    // the "[Y/n] defaults to yes" rule would read as agreement to spend.
    await expect(confirmRun({ ...fakeIo(""), isTTY: false })).rejects.toBeInstanceOf(NotATerminalError);
    await expect(confirmRun({ ...fakeIo(""), isTTY: false })).rejects.toThrow(NOT_A_TERMINAL_MESSAGE);
    expect(NOT_A_TERMINAL_MESSAGE).toBe("Not a terminal. Re-run with --yes.");
  });

  it("still asks a caller-supplied scripted stream (tests, an embedding host)", async () => {
    await expect(confirmRun({ ...fakeIo("y"), isTTY: true })).resolves.toBe(true);
  });
});

// SINGLE-PROVIDER MODE: the preflight Judge line.
describe("formatJudgeMode", () => {
  it("two judgment keys read as cross-family", () => {
    expect(formatJudgeMode({ openai: "sk-a", anthropic: "sk-ant-b" })).toBe(
      "cross-family (OpenAI ↔ Anthropic)",
    );
  });

  it("one key reads as single-family and names the env var that restores cross-family", () => {
    expect(formatJudgeMode({ openai: "sk-a" })).toBe(
      "single-family (OpenAI only; add ANTHROPIC_API_KEY for cross-family)",
    );
    expect(formatJudgeMode({ anthropic: "sk-ant-b" })).toBe(
      "single-family (Anthropic only; add OPENAI_API_KEY for cross-family)",
    );
  });

  it("answer-only keys never count as a judgment family", () => {
    expect(formatJudgeMode({ gemini: "g", perplexity: "p" })).toBe(
      "none (add OPENAI_API_KEY or ANTHROPIC_API_KEY)",
    );
  });
});

describe("formatJudgeModels", () => {
  it("cross-family: names both distinct judge models", () => {
    const roles = engineMod.resolveRoles({ openai: true, anthropic: true });
    expect(formatJudgeModels(roles)).toBe("claude-haiku-4-5 / gpt-5-mini");
  });

  it("single-family: names the one judge model that serves every engine", () => {
    const roles = engineMod.resolveRoles({ anthropic: true });
    expect(formatJudgeModels(roles)).toBe("claude-haiku-4-5");
  });

  it("reflects a --judge / saylent.config models override", () => {
    const roles = engineMod.resolveRoles(
      { openai: true, anthropic: true },
      { flags: { judge: { anthropic: "claude-custom-judge" } } },
    );
    expect(formatJudgeModels(roles)).toBe("claude-custom-judge / gpt-5-mini");
  });
});
