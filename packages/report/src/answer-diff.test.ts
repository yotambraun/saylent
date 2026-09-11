// SPIKE tests for the Pulse diff engine (docs: prototype, not a phase gate).
// Covers: added detected, removed detected, identical → no diff, brand-mention
// ranking, and the load-bearing one — markdown/emphasis noise is NOT a change.
import { describe, expect, it } from "vitest";
import {
  type DiffAnswerInput,
  diffAnswer,
  diffRuns,
  normalizeForCompare,
  splitSentences,
} from "./answer-diff";

const ALIASES = ["Trackflow", "trackflow.example"];

const mk = (raw: string, over: Partial<DiffAnswerInput> = {}): DiffAnswerInput => ({
  qid: "q01",
  engine: "chatgpt",
  question: "Best product development platform?",
  raw_text: raw,
  ...over,
});

describe("splitSentences", () => {
  it("keeps decimals, abbreviations, and date ranges whole", () => {
    const s = splitSentences(
      "Trackflow scores 4.5 out of 5, e.g. on speed. It grew across 2025–2026 too.",
    );
    expect(s).toHaveLength(2);
    expect(s[0]).toContain("4.5");
    expect(s[0]).toContain("e.g.");
    expect(s[1]).toContain("2025–2026");
  });

  it("treats bullet lines as separate sentences", () => {
    const s = splitSentences("- First point about speed\n- Second point about UX");
    expect(s).toEqual(["First point about speed", "Second point about UX"]);
  });
});

describe("normalizeForCompare", () => {
  it("erases emphasis markers and links", () => {
    expect(normalizeForCompare("**Trackflow** is [fast](https://x.com).")).toBe(
      "trackflow is fast.",
    );
  });
});

describe("diffAnswer", () => {
  it("detects an added sentence", () => {
    const base = mk("Jira is the default pick for large teams.");
    const cur = mk(
      "Jira is the default pick for large teams. Trackflow is now the most compelling modern option.",
    );
    const d = diffAnswer(base, cur, ALIASES);
    expect(d.added).toHaveLength(1);
    expect(d.added[0].text).toContain("Trackflow is now the most compelling");
    expect(d.added[0].mentionsBrand).toBe(true);
    expect(d.removed).toHaveLength(0);
    expect(d.brandTouched).toBe(true);
  });

  it("detects a removed sentence", () => {
    const base = mk("Jira leads the pack. Trackflow is a strong alternative for fast teams.");
    const cur = mk("Jira leads the pack.");
    const d = diffAnswer(base, cur, ALIASES);
    expect(d.removed).toHaveLength(1);
    expect(d.removed[0].text).toContain("Trackflow is a strong alternative");
    expect(d.added).toHaveLength(0);
    expect(d.brandTouched).toBe(true);
  });

  it("identical answers produce no diff", () => {
    const text = "Jira leads. Trackflow is fast. Asana is broad.";
    const d = diffAnswer(mk(text), mk(text), ALIASES);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.brandTouched).toBe(false);
  });

  it("markdown/formatting noise is NOT a change", () => {
    // same sentence, only emphasis markers differ → must not surface as a diff
    const base = mk("Trackflow is fast. Jira is broad.");
    const cur = mk("**Trackflow** is fast. _Jira_ is broad.");
    const d = diffAnswer(base, cur, ALIASES);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
  });

  it("ranks brand-mentioning added sentences first", () => {
    const base = mk("Intro line.");
    const cur = mk(
      "Intro line. Asana and Monday are also worth a look for broader teams overall. Trackflow wins.",
    );
    const d = diffAnswer(base, cur, ALIASES);
    // the shorter brand sentence must outrank the longer non-brand one
    expect(d.added[0].text).toContain("Trackflow wins");
    expect(d.added[0].mentionsBrand).toBe(true);
    expect(d.added[1].mentionsBrand).toBe(false);
  });

  it("caps at 3 added sentences", () => {
    const base = mk("Start.");
    const cur = mk("Start. One here. Two here. Three here. Four here. Five here.");
    const d = diffAnswer(base, cur, ALIASES);
    expect(d.added).toHaveLength(3);
  });
});

describe("diffRuns", () => {
  it("pairs by (qid, engine), drops empty diffs, brand-touching first", () => {
    const baseline: DiffAnswerInput[] = [
      mk("Jira leads.", { qid: "q01", engine: "chatgpt" }),
      mk("Same on both.", { qid: "q02", engine: "claude" }),
      mk("Older take without the brand.", { qid: "q03", engine: "gemini" }),
    ];
    const current: DiffAnswerInput[] = [
      mk("Jira leads. Trackflow is the top alternative now.", { qid: "q01", engine: "chatgpt" }),
      mk("Same on both.", { qid: "q02", engine: "claude" }),
      mk("A different neutral take without the brand.", { qid: "q03", engine: "gemini" }),
    ];
    const diffs = diffRuns(baseline, current, ALIASES);
    // q02 unchanged → dropped; q01 (brand) + q03 (non-brand) remain
    expect(diffs).toHaveLength(2);
    expect(diffs[0].qid).toBe("q01");
    expect(diffs[0].brandTouched).toBe(true);
    expect(diffs[1].qid).toBe("q03");
    expect(diffs[1].brandTouched).toBe(false);
  });

  it("ignores answers with no counterpart in the baseline", () => {
    const diffs = diffRuns(
      [mk("Only current has this qid.", { qid: "q09" })],
      [mk("New answer entirely.", { qid: "q10" })],
      ALIASES,
    );
    expect(diffs).toHaveLength(0);
  });
});
