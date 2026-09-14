// The pure half of the app's
// Questions and run options tab. Three things are being pinned here:
//   1. the validation behaves like the CLI's --questions loader, because a set
//      edited in the app and a set edited in questions.json must mean the same;
//   2. the two constants this module mirrors rather than imports (the scored
//      types and the non-answer role rates) can never drift from the engine;
//   3. the estimate moves for the reasons a user is told it moves.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// A TEST-ONLY relative import. The app never depends on @saylent/cli (it has to
// build without the CLI installed), but the two files must agree, so the suite
// reaches across the workspace to check.
import {
  QUESTION_TYPES as CLI_QUESTION_TYPES,
  SCORED_TYPES as CLI_SCORED_TYPES,
} from "../../packages/cli/src/questions-file";
import {
  FULL_COST_SENTENCE as CLI_FULL_COST_SENTENCE,
  SMOKE_COST_SENTENCE as CLI_SMOKE_COST_SENTENCE,
} from "../../packages/cli/src/preflight";
import { ALL_ENGINES } from "@saylent/engine/engines";
import { MAX_SAMPLES, PROFILES } from "@saylent/engine/profiles";
import { generateQuestions } from "@saylent/engine/questions";
import { ROLE_COST_CENTS } from "@saylent/engine/run-audit";
import { isScored } from "@saylent/engine/score";
import type { BrandModel } from "@saylent/engine/types";
import {
  FULL_COMPUTED_USD,
  FULL_COST_SENTENCE,
  FULL_RANGE_TEXT,
  FULL_RANGE_USD,
  publishedRange,
  RECORDED_SMOKE_RUNS_USD,
  SMOKE_COMPUTED_USD,
  SMOKE_COST_SENTENCE,
  SMOKE_RANGE_TEXT,
  SMOKE_RANGE_USD,
} from "./cost-copy";
import {
  type DraftQuestion,
  estimateRunCost,
  isBandCounted,
  MAX_QUESTION_ID_CHARS,
  MAX_QUESTIONS,
  normalizeDraftQuestions,
  normalizeRunOptions,
  QUESTION_TYPES,
  questionIdError,
  questionsChanged,
  ROLE_CENTS,
  runInputFromOptions,
  SCORED_TYPES,
  toDraftQuestions,
  toEngineQuestions,
  askedForProfile,
} from "./question-options";

const row = (over: Partial<DraftQuestion> = {}): DraftQuestion => ({
  id: "q01",
  type: "category",
  text: "What is the best uptime monitor for small teams?",
  source: "template",
  ...over,
});

describe("the constants this module mirrors instead of importing", () => {
  it("scores exactly the types the engine scores", () => {
    for (const type of QUESTION_TYPES) {
      expect(isBandCounted(type)).toBe(isScored(type));
    }
    expect([...SCORED_TYPES]).toEqual(["category", "problem"]);
  });

  it("keeps the non-answer role rates identical to the engine's", () => {
    // ROLE_COST_CENTS lives in run-audit.ts, which drags the crawler in and so
    // cannot be imported by a browser bundle. If the engine ever reprices a
    // role, this fails and the estimate gets corrected with it.
    expect(ROLE_CENTS).toEqual(ROLE_COST_CENTS);
  });
});

describe("normalizeDraftQuestions", () => {
  it("assigns a free id to a row that has none, without colliding", () => {
    const res = normalizeDraftQuestions([
      { id: "q01", text: "a" },
      { text: "b" },
      { id: "q02", text: "c" },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.map((r) => r.id)).toEqual(["q01", "q03", "q02"]);
  });

  it("types an untagged or unknown row as custom, which keeps it out of the band", () => {
    const res = normalizeDraftQuestions([{ text: "a" }, { type: "nonsense", text: "b" }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.map((r) => r.type)).toEqual(["custom", "custom"]);
    expect(res.value.every((r) => !isBandCounted(r.type))).toBe(true);
  });

  it("marks every row the user touched as theirs", () => {
    const res = normalizeDraftQuestions([{ text: "a" }, { text: "b", source: "template" }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.map((r) => r.source)).toEqual(["user", "template"]);
  });

  it("refuses a row with no text rather than dropping it silently", () => {
    const res = normalizeDraftQuestions([row(), { id: "q02", text: "   " }]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("needs text");
  });

  it("holds samples to whole numbers 1-5", () => {
    for (const bad of [0, 6, 2.5, "two"]) {
      const res = normalizeDraftQuestions([{ id: "q07", text: "a", samples: bad }]);
      expect(res.ok, `samples=${String(bad)}`).toBe(false);
      if (!res.ok) expect(res.error).toContain("q07");
    }
    const good = normalizeDraftQuestions([{ id: "q07", text: "a", samples: MAX_SAMPLES }]);
    expect(good.ok).toBe(true);
  });

  it("refuses an empty set and a set past the cap", () => {
    expect(normalizeDraftQuestions([]).ok).toBe(false);
    const tooMany = Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => ({ text: `q ${i}` }));
    const res = normalizeDraftQuestions(tooMany);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(String(MAX_QUESTIONS));
  });

  it("round-trips through the engine's Question shape", () => {
    const rows = [row(), row({ id: "q02", type: "custom", source: "user", samples: 3 })];
    expect(toDraftQuestions(toEngineQuestions(rows))).toEqual(rows);
  });
});

describe("normalizeRunOptions", () => {
  const base = { questions: [row()], now: "2026-09-10T00:00:00.000Z" };

  it("stores nothing for a field left at its default", () => {
    const res = normalizeRunOptions({ ...base, engines: [...ALL_ENGINES], locale: "  " });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.engines).toBeUndefined(); // all four is the default
    expect(res.value.locale).toBeUndefined();
    expect(res.value.skip).toBeUndefined();
    expect(res.value.updated_at).toBe("2026-09-10T00:00:00.000Z");
  });

  it("refuses a single-engine selection at the floor", () => {
    const res = normalizeRunOptions({ ...base, engines: ["chatgpt"] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("at least 2");
  });

  it("keeps a valid narrowed selection in canonical order", () => {
    const res = normalizeRunOptions({ ...base, engines: ["perplexity", "chatgpt"] });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.engines).toEqual(["chatgpt", "perplexity"]);
  });

  it("checks the language tag", () => {
    expect(normalizeRunOptions({ ...base, locale: "pt-BR" }).ok).toBe(true);
    const bad = normalizeRunOptions({ ...base, locale: "Brazilian Portuguese" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("language tag");
  });

  it("stores only the skips that are on", () => {
    const res = normalizeRunOptions({ ...base, skip: { drafts: true, corpus: false } });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.skip).toEqual({ drafts: true });
  });

  it("holds the run-level sample count to 1-5", () => {
    expect(normalizeRunOptions({ ...base, samples: 9 }).ok).toBe(false);
    expect(normalizeRunOptions({ ...base, samples: 3 }).ok).toBe(true);
  });
});

describe("questionsChanged", () => {
  const baseline = [row(), row({ id: "q02", type: "problem", text: "How do I stop pager noise?" })];

  it("ignores a renumbered but identical set", () => {
    const renumbered = baseline.map((r, i) => ({ ...r, id: `x${i}` }));
    expect(questionsChanged(baseline, renumbered)).toBe(false);
  });

  it("sees edited text, a retyped row, and a per-question sample override", () => {
    expect(questionsChanged(baseline, [{ ...baseline[0], text: "other" }, baseline[1]])).toBe(true);
    expect(questionsChanged(baseline, [{ ...baseline[0], type: "custom" }, baseline[1]])).toBe(true);
    expect(questionsChanged(baseline, [{ ...baseline[0], samples: 4 }, baseline[1]])).toBe(true);
    expect(questionsChanged(baseline, [baseline[0]])).toBe(true);
  });
});

describe("askedForProfile", () => {
  const set = [
    ...Array.from({ length: 8 }, (_, i) => row({ id: `c${i}`, type: "category" })),
    ...Array.from({ length: 5 }, (_, i) => row({ id: `h${i}`, type: "comparison" })),
    ...Array.from({ length: 4 }, (_, i) => row({ id: `p${i}`, type: "problem" })),
    ...Array.from({ length: 3 }, (_, i) => row({ id: `b${i}`, type: "branded" })),
    row({ id: "t0", type: "trust" }),
  ];

  it("full asks the whole set", () => {
    expect(askedForProfile(set, "full")).toHaveLength(set.length);
  });

  it("smoke asks the engine's six: first of each type, then category and comparison", () => {
    const asked = askedForProfile(set, "smoke");
    expect(asked.map((r) => r.id)).toEqual(["c0", "h0", "p0", "b0", "c1", "h1"]);
    expect(asked).toHaveLength(PROFILES.smoke.questions);
  });

  it("smoke always asks the operator's own rows and fills the rest", () => {
    const mine = [row({ id: "u1", type: "custom", source: "user" }), row({ id: "u2", type: "custom", source: "user" })];
    const asked = askedForProfile([...set, ...mine], "smoke");
    expect(asked.slice(0, 2).map((r) => r.id)).toEqual(["u1", "u2"]);
    expect(asked).toHaveLength(PROFILES.smoke.questions);
  });

  it("the smoke estimate prices six questions, not the set, and says so", () => {
    const smoke = estimateRunCost({ questions: set, engines: [...ALL_ENGINES], samples: 1, profile: "smoke" });
    const full = estimateRunCost({ questions: set, engines: [...ALL_ENGINES], samples: 1, profile: "full" });
    expect(smoke.asked).toBe(6);
    expect(smoke.total).toBe(set.length);
    expect(full.asked).toBe(set.length);
    expect(smoke.drawsLow).toBe(6 * ALL_ENGINES.length);
    expect(smoke.highUsd).toBeLessThan(full.highUsd / 2);
  });
});

describe("estimateRunCost", () => {
  const scored = Array.from({ length: 10 }, (_, i) => row({ id: `q${i}`, type: "category" }));
  const four = [...ALL_ENGINES];

  it("charges more for more samples", () => {
    const one = estimateRunCost({ questions: scored, engines: four, samples: 1 });
    const three = estimateRunCost({ questions: scored, engines: four, samples: 3 });
    expect(three.drawsLow).toBe(one.drawsLow * 3);
    expect(three.highUsd).toBeGreaterThan(one.highUsd);
  });

  it("only opens a range where the adaptive tiebreak can fire (n=2)", () => {
    const two = estimateRunCost({ questions: scored, engines: four, samples: 2 });
    expect(two.drawsHigh).toBe(two.drawsLow * 1.5);
    const three = estimateRunCost({ questions: scored, engines: four, samples: 3 });
    expect(three.drawsHigh).toBe(three.drawsLow);
  });

  it("charges nothing extra for unscored rows beyond their single draw", () => {
    const mixed = [...scored, row({ id: "qx", type: "custom" })];
    const a = estimateRunCost({ questions: scored, engines: four, samples: 2 });
    const b = estimateRunCost({ questions: mixed, engines: four, samples: 2 });
    expect(b.scored).toBe(a.scored);
    expect(b.drawsLow).toBe(a.drawsLow + four.length);
  });

  it("honours a per-question sample override", () => {
    const withOverride = [row({ id: "q01", type: "category", samples: 5 }), ...scored.slice(1)];
    const plain = estimateRunCost({ questions: scored, engines: four, samples: 1 });
    const over = estimateRunCost({ questions: withOverride, engines: four, samples: 1 });
    expect(over.drawsLow).toBe(plain.drawsLow + 4 * four.length);
  });

  it("costs less on fewer engines", () => {
    const four4 = estimateRunCost({ questions: scored, engines: four, samples: 2 });
    const two = estimateRunCost({ questions: scored, engines: ["chatgpt", "gemini"], samples: 2 });
    expect(two.engines).toBe(2);
    expect(two.highUsd).toBeLessThan(four4.highUsd);
  });

  it("drops the drafter calls when the fix drafts are skipped, and nothing else does", () => {
    const full = estimateRunCost({ questions: scored, engines: four, samples: 2 });
    const noDrafts = estimateRunCost({
      questions: scored,
      engines: four,
      samples: 2,
      skip: { drafts: true },
    });
    const drafterCost = (ROLE_CENTS.drafter * PROFILES.full.draftTop) / 100;
    expect(full.highUsd - noDrafts.highUsd).toBeCloseTo(drafterCost, 2);
    // The corpus and the gate checks are our own crawl, not a model call: they
    // change what the report can show, never the bill.
    const noCorpus = estimateRunCost({
      questions: scored,
      engines: four,
      samples: 2,
      skip: { corpus: true, gates: true },
    });
    expect(noCorpus.highUsd).toBe(full.highUsd);
  });

  it("falls back to all four engines when the selection is below the floor", () => {
    const one = estimateRunCost({ questions: scored, engines: ["chatgpt"], samples: 2 });
    expect(one.engines).toBe(ALL_ENGINES.length);
  });
});

describe("runInputFromOptions", () => {
  const frozen = { questions: toEngineQuestions([row()]), version: 3, engines: ["chatgpt", "claude"] };
  const edited = [row({ text: "my own question", type: "custom", source: "user", samples: 4 })];

  it("hands an edited set to the pipeline the way --questions does, and freezes the engines with it", () => {
    const mapped = runInputFromOptions({
      kind: "audit",
      runOptions: { questions: edited, samples: 3, engines: ["chatgpt", "gemini"], locale: "de" },
      brandEngines: null,
      brandQuestionSet: null,
      brandQuestionSetVersion: 2,
    });
    expect(mapped.suppliedQuestions).toBe(true);
    expect(mapped.questionSet?.questions?.[0]).toMatchObject({
      qid: "q01",
      qtype: "custom",
      text: "my own question",
      samples: 4,
    });
    expect(mapped.questionSet?.engines).toEqual(["chatgpt", "gemini"]);
    expect(mapped.questionSetVersion).toBe(2);
    expect(mapped.samples).toBe(3);
    // Same rule the CLI prints: a reused set is never regenerated, so there is
    // nothing for a locale to translate.
    expect(mapped.locale).toBeNull();
  });

  it("keeps the locale when the set will be freshly generated", () => {
    const mapped = runInputFromOptions({
      kind: "audit",
      runOptions: { locale: "pt-BR", skip: { drafts: true } },
      brandEngines: ["chatgpt", "claude"],
      brandQuestionSet: null,
      brandQuestionSetVersion: 1,
    });
    expect(mapped.suppliedQuestions).toBe(false);
    expect(mapped.questionSet).toBeNull();
    expect(mapped.locale).toBe("pt-BR");
    expect(mapped.skip).toEqual({ drafts: true });
    expect(mapped.engines).toEqual(["chatgpt", "claude"]);
  });

  it("reuses the brand's frozen set when nothing was edited", () => {
    const mapped = runInputFromOptions({
      kind: "audit",
      runOptions: { samples: 4 },
      brandEngines: null,
      brandQuestionSet: frozen,
      brandQuestionSetVersion: 3,
    });
    expect(mapped.questionSet).toBe(frozen);
    expect(mapped.suppliedQuestions).toBe(false);
  });

  it("ignores every run option on a verify, because a verify must re-ask the baseline", () => {
    const mapped = runInputFromOptions({
      kind: "verify",
      runOptions: { questions: edited, samples: 5, engines: ["chatgpt", "gemini"], locale: "de", skip: { drafts: true } },
      brandEngines: ["chatgpt", "claude"],
      brandQuestionSet: frozen,
      brandQuestionSetVersion: 3,
    });
    expect(mapped.questionSet).toBe(frozen);
    expect(mapped.suppliedQuestions).toBe(false);
    expect(mapped.samples).toBeNull();
    expect(mapped.locale).toBeNull();
    expect(mapped.skip).toBeNull();
    expect(mapped.engines).toEqual(["chatgpt", "claude"]);
  });
});

describe("parity with the CLI's questions file", () => {
  it("recognises the same question types and scores the same ones", () => {
    expect([...QUESTION_TYPES]).toEqual([...CLI_QUESTION_TYPES]);
    expect([...SCORED_TYPES]).toEqual([...CLI_SCORED_TYPES]);
  });
});

// ---------------------------------------------------------------------------
// A draft question `id` came off the form unbounded and
// unvalidated, then rode into brands.run_options, the frozen envelope, the run
// bundle and the report.
// ---------------------------------------------------------------------------
describe("question ids are bounded (#16)", () => {
  it("rejects an id longer than 32 characters", () => {
    const long = "q".repeat(MAX_QUESTION_ID_CHARS + 1);
    expect(questionIdError(long)).toContain(String(MAX_QUESTION_ID_CHARS));

    const result = normalizeDraftQuestions([{ id: long, text: "Who is best?" }]);
    expect(result.ok).toBe(false);
  });

  it("rejects an id with characters outside [A-Za-z0-9_-]", () => {
    for (const id of [
      "../../etc/passwd",
      "q01 q02",
      "<script>alert(1)</script>",
      "q01\n",
      "q.01",
      "q/01",
      "q\u0000",
      "q01;DROP TABLE runs",
    ]) {
      expect(questionIdError(id), id).not.toBeNull();
      expect(normalizeDraftQuestions([{ id, text: "Who is best?" }]).ok, id).toBe(false);
    }
  });

  it("a rejected id never reaches the id assigner", () => {
    // the bad row is refused outright — no run is normalized around it
    const result = normalizeDraftQuestions([
      { id: "x".repeat(200), text: "one" },
      { text: "two" },
    ]);
    expect(result.ok).toBe(false);
  });

  it("still accepts the ids the product actually produces", () => {
    expect(questionIdError("q01")).toBeNull();
    expect(questionIdError("custom_intent-3")).toBeNull();
    expect(questionIdError("Q".repeat(MAX_QUESTION_ID_CHARS))).toBeNull();

    const result = normalizeDraftQuestions([
      { id: "q01", text: "Who is best?" },
      { text: "And who else?" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((q) => q.id)).toEqual(["q01", "q02"]);
  });
});

// ---------------------------------------------------------------------------
// ONE cost truth (src/lib/cost-copy.ts)
// ---------------------------------------------------------------------------
// Every price printed in prose — both READMEs, the docs, .env.example, the
// landing page and the CLI preflight — comes from cost-copy.ts, and cost-copy.ts
// claims to be what THIS estimator produces for the shipped template set. That
// claim is checked here: a provider rate change, a profile change or a template
// change moves the computed range, and this suite fails until the published
// copy is re-derived. The CLI carries its own copy of the two sentences
// (packages/cli/src/preflight.ts — the published CLI cannot import from src/),
// so both are pinned against the same numbers.
describe("the published cost ranges", () => {
  // The shipped 23-question set, generated exactly as a real run generates it:
  // a brand with two competitors, so every comparison template resolves.
  const brand: BrandModel = {
    brand: "Kestrel Uptime",
    domain: "kestreluptime.com",
    aliases: ["Kestrel Uptime", "kestrel"],
    category: "uptime monitoring",
    icp: "small SaaS teams",
    products: [],
    value_props: [],
    problems: ["missed outages", "noisy alerts"],
    competitors: ["Upcheck", "Beacon Uptime"],
    language: "en",
  };
  const shipped = toDraftQuestions(generateQuestions(brand, 2026));
  const four = [...ALL_ENGINES];

  it("generates the 23-question set the copy is priced from", () => {
    expect(shipped).toHaveLength(PROFILES.full.questions);
  });

  it("cost-copy's computed figures are what the estimator returns", () => {
    const full = estimateRunCost({ questions: shipped, engines: four, samples: 2, profile: "full" });
    const smoke = estimateRunCost({ questions: shipped, engines: four, samples: 1, profile: "smoke" });
    expect({ lowUsd: full.lowUsd, highUsd: full.highUsd }).toEqual(FULL_COMPUTED_USD);
    expect({ lowUsd: smoke.lowUsd, highUsd: smoke.highUsd }).toEqual(SMOKE_COMPUTED_USD);
  });

  it("the published ranges are those figures, rounded outward and widened to the recorded runs", () => {
    const full = estimateRunCost({ questions: shipped, engines: four, samples: 2, profile: "full" });
    const smoke = estimateRunCost({ questions: shipped, engines: four, samples: 1, profile: "smoke" });
    expect(publishedRange(full)).toEqual(FULL_RANGE_USD);
    expect(publishedRange(smoke, RECORDED_SMOKE_RUNS_USD)).toEqual(SMOKE_RANGE_USD);
    for (const recorded of RECORDED_SMOKE_RUNS_USD) {
      expect(recorded).toBeGreaterThanOrEqual(SMOKE_RANGE_USD.lowUsd);
      expect(recorded).toBeLessThanOrEqual(SMOKE_RANGE_USD.highUsd);
    }
  });

  it("the CLI's own copy of the two sentences says the same numbers", () => {
    expect(CLI_SMOKE_COST_SENTENCE).toBe(SMOKE_COST_SENTENCE);
    expect(CLI_FULL_COST_SENTENCE).toBe(FULL_COST_SENTENCE);
    expect(CLI_SMOKE_COST_SENTENCE).toContain(SMOKE_RANGE_TEXT);
    expect(CLI_FULL_COST_SENTENCE).toContain(FULL_RANGE_TEXT);
  });

  // The point of one source of truth is that the SURFACES quote it. These are
  // the files a stranger reads a price from; each must carry the current range.
  it("every surface that prints a price quotes the current ranges", () => {
    const surfaces: [file: string, ranges: string[]][] = [
      ["README.public.md", [SMOKE_RANGE_TEXT, FULL_RANGE_TEXT]],
      ["packages/cli/README.md", [SMOKE_RANGE_TEXT, FULL_RANGE_TEXT]],
      ["website/content/docs/costs.mdx", [SMOKE_RANGE_TEXT, FULL_RANGE_TEXT]],
      ["website/content/docs/quickstart.mdx", [SMOKE_RANGE_TEXT, FULL_RANGE_TEXT]],
      ["website/content/docs/mcp.mdx", [SMOKE_RANGE_TEXT, FULL_RANGE_TEXT]],
      ["website/content/docs/self-host/environment.mdx", [FULL_RANGE_TEXT]],
      ["website/app/page.tsx", [SMOKE_RANGE_TEXT]],
      [".env.example", [SMOKE_RANGE_TEXT, FULL_RANGE_TEXT]],
    ];
    for (const [file, ranges] of surfaces) {
      const text = readFileSync(path.join(process.cwd(), file), "utf8");
      for (const range of ranges) expect(text, `${file} must quote ${range}`).toContain(range);
    }
  });
});
