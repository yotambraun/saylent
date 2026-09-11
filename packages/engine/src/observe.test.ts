// Observe sampling, call-cap draw math, and the adaptive tiebreak ask.
import { describe, expect, it, vi } from "vitest";
import type { AskResult } from "./adapters";
import { askTiebreakDraw, CALL_CAP, type DrawRow, observeEngine, plannedDraws } from "./observe";
import type { BrandModel, DbWriter, Engine, Question } from "./types";

const bm = { brand: "Acme" } as unknown as BrandModel;
const noopDb = {
  setStage: vi.fn(async () => {}),
} as unknown as DbWriter;

const q = (qid: string, qtype: Question["qtype"]): Question => ({ qid, text: `${qid}?`, qtype });

const okResult = (text: string): AskResult => ({ ok: true, text, citations: [] });

describe("plannedDraws", () => {
  const engines: Engine[] = ["chatgpt", "claude", "gemini", "perplexity"];
  // The call-cap guard passes profiles.maxDrawsFor — the WORST case (scored → 3
  // with the adaptive tiebreak), so the backstop budgets the maximum a run can
  // attempt.
  const maxSc = (question: Question) => (question.qtype === "category" || question.qtype === "problem" ? 3 : 1);

  it("counts fanned-out draws, not question×engine pairs", () => {
    const questions = [q("q01", "category"), q("q02", "branded")]; // 3 + 1 = 4 per engine
    expect(plannedDraws(questions, engines, maxSc)).toBe(16);
  });

  it("adaptive full-v2 WORST case (188 draws, every scored question tiebroken) is under CALL_CAP", () => {
    const questions: Question[] = [];
    for (let i = 0; i < 12; i++) questions.push(q(`s${i}`, "category")); // 12 scored → ×3 worst case
    for (let i = 0; i < 11; i++) questions.push(q(`n${i}`, "branded")); // 11 non-scored → ×1
    const total = plannedDraws(questions, engines, maxSc); // (12*3 + 11) * 4
    expect(total).toBe(188);
    expect(total).toBeLessThanOrEqual(CALL_CAP);
  });
});

describe("observeEngine sampling", () => {
  it("asks scored questions N INITIAL times (draws 0..N-1) and non-scored once", async () => {
    const asked: string[] = [];
    const ask = vi.fn(async (_e: Engine, text: string) => {
      asked.push(text);
      return okResult(`${text}#${asked.filter((t) => t === text).length - 1}`);
    });
    const questions = [q("q01", "category"), q("q02", "branded")];
    // adaptive: scored questions get 2 INITIAL draws (the tiebreak is decided later).
    const sc = (question: Question) => (question.qtype === "category" ? 2 : 1);

    const draws = await observeEngine("chatgpt", questions, bm, ask, noopDb, "run1", sc);

    // 2 initial draws for the category question + 1 for the branded question
    expect(draws.filter((d) => d.qid === "q01")).toHaveLength(2);
    expect(draws.filter((d) => d.qid === "q02")).toHaveLength(1);
    expect(draws.filter((d) => d.qid === "q01").map((d) => d.sampleIdx).sort()).toEqual([0, 1]);
    expect(ask).toHaveBeenCalledTimes(3);
    // every draw carries the engine + is pre-verdict
    expect(draws.every((d) => d.engine === "chatgpt" && d.verdict === undefined)).toBe(true);
  });

  it("defaults to a single draw when no sampleCountFn is given", async () => {
    const ask = vi.fn(async (_e: Engine, text: string) => okResult(text));
    const draws = await observeEngine("claude", [q("q01", "category")], bm, ask, noopDb, "run1");
    expect(draws).toHaveLength(1);
    expect(draws[0].sampleIdx).toBe(0);
  });

  // Samples feature: a per-question override (q.samples) wins over whatever
  // the caller's sampleCountFn would otherwise return for that qtype.
  it("a per-question samples override changes the draw count for that question only", async () => {
    const ask = vi.fn(async (_e: Engine, text: string) => okResult(text));
    const questions: Question[] = [
      { ...q("q01", "category"), samples: 4 },
      q("q02", "category"), // no override — falls back to sampleCountFn
    ];
    const sc = (question: Question) => question.samples ?? 2;
    const draws = await observeEngine("chatgpt", questions, bm, ask, noopDb, "run1", sc);
    expect(draws.filter((d) => d.qid === "q01")).toHaveLength(4);
    expect(draws.filter((d) => d.qid === "q02")).toHaveLength(2);
  });
});

describe("askTiebreakDraw", () => {
  const drawOf = (sampleIdx: number): DrawRow => ({
    qid: "q01",
    qtype: "category",
    question: "best X for teams?",
    engine: "perplexity",
    sampleIdx,
    ok: true,
    raw_text: `r${sampleIdx}`,
    citations: [],
  });

  it("asks ONE more draw tagged sampleIdx = group.length, preserving question identity", async () => {
    const group = [drawOf(0), drawOf(1)]; // a 2-draw scored group
    const ask = vi.fn(
      async (): Promise<AskResult> => ({
        ok: true,
        text: "tiebreak answer",
        citations: [{ url: "https://x.test", title: "X" }],
        usage: { input_tokens: 10, output_tokens: 5, searches: 1 },
      }),
    );
    const tb = await askTiebreakDraw(group, ask);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith("perplexity", "best X for teams?");
    expect(tb.sampleIdx).toBe(2); // 0,1 taken → tiebreak is idx 2
    expect(tb.qid).toBe("q01");
    expect(tb.qtype).toBe("category");
    expect(tb.engine).toBe("perplexity");
    expect(tb.ok).toBe(true);
    expect(tb.raw_text).toBe("tiebreak answer");
    expect(tb.citations).toEqual([{ url: "https://x.test", title: "X" }]);
    expect(tb.usage).toEqual({ input_tokens: 10, output_tokens: 5, searches: 1 });
    expect(tb.verdict).toBeUndefined(); // pre-verdict — the caller judges it
  });

  it("carries a failed tiebreak's error and stays pre-verdict", async () => {
    const group = [drawOf(0), drawOf(1)];
    const ask = vi.fn(
      async (): Promise<AskResult> => ({ ok: false, text: "", citations: [], error: "timeout" }),
    );
    const tb = await askTiebreakDraw(group, ask);
    expect(tb.ok).toBe(false);
    expect(tb.error).toBe("timeout");
    expect(tb.sampleIdx).toBe(2);
  });
});
