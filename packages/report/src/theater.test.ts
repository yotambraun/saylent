// Audit Theater derivations. Fixtures mirror the smoke-run shape (fixtures/run.json,
// Trackflow): 6 questions asked out of a 20-question frozen set, four engines. The
// cases walk the live lifecycle — empty run → partial observe → judge overlay —
// plus the degenerate paths (missing verdict, no question_set).
import { describe, expect, it } from "vitest";
import {
  deriveTheater,
  type TheaterAnswer,
  type TheaterQuestion,
} from "./theater";

const QSET: TheaterQuestion[] = [
  { qid: "q01", qtype: "category", text: "What is the best product development platform?" },
  { qid: "q02", qtype: "category", text: "Top product development platform options in 2026?" },
  { qid: "q09", qtype: "comparison", text: "Trackflow vs Jira — which is better?" },
  { qid: "q10", qtype: "comparison", text: "Jira vs another leading option?" },
  { qid: "q14", qtype: "problem", text: "How do I solve cross-team dependencies?" },
  { qid: "q18", qtype: "branded", text: "What is Trackflow? Is it any good?" },
  // frozen-set questions a smoke run never asks — must never surface as rows
  { qid: "q20", qtype: "branded", text: "Trackflow pricing, reviews, and alternatives" },
];

const ans = (o: Partial<TheaterAnswer> & Pick<TheaterAnswer, "qid" | "engine">): TheaterAnswer => ({
  ok: true,
  question: QSET.find((q) => q.qid === o.qid)?.text ?? "",
  qtype: QSET.find((q) => q.qid === o.qid)?.qtype ?? "category",
  excerpt: "Trackflow is a fast product development tool…",
  citations: [{ url: "https://www.trackflow.example/features" }, { url: "https://trackflow.example/pricing" }],
  brand_present: null,
  created_at: "2026-07-12T17:52:14.000Z",
  ...o,
});

describe("deriveTheater — empty run (deep prep, no answers)", () => {
  const t = deriveTheater({
    questions: QSET,
    answers: [],
    stage: "Building your brand model",
    status: "running",
    profile: "smoke",
  });
  it("is active (question set present) but shows no board rows yet", () => {
    expect(t.active).toBe(true);
    expect(t.phase).toBe("prep");
    expect(t.board).toEqual([]);
    expect(t.spotlight).toBeNull();
  });
  it("knows the expected total from the profile before any stage detail", () => {
    expect(t.counters.expectedTotal).toBe(24); // 6 smoke questions × 4 engines
    expect(t.counters.answersIn).toBe(0);
    expect(t.counters.mentions).toBeNull(); // never 0 before judging begins
  });
});

describe("deriveTheater — partial observe", () => {
  // chatgpt has answered 3 of the 6; one of them (q10) failed for chatgpt
  const answers: TheaterAnswer[] = [
    ans({ qid: "q01", engine: "chatgpt", created_at: "2026-07-12T17:52:10.000Z" }),
    ans({ qid: "q02", engine: "chatgpt", created_at: "2026-07-12T17:52:12.000Z" }),
    ans({ qid: "q10", engine: "chatgpt", ok: false, excerpt: "", citations: [], created_at: "2026-07-12T17:52:14.000Z" }),
  ];
  const t = deriveTheater({
    questions: QSET,
    answers,
    stage: "Asking ChatGPT · 3/6 answered",
    status: "running",
    profile: "smoke",
  });

  it("surfaces only the questions that have an answer, in frozen order", () => {
    expect(t.phase).toBe("observe");
    expect(t.board.map((r) => r.qid)).toEqual(["q01", "q02", "q10"]);
  });
  it("marks answered slots and leaves the other engines empty", () => {
    const row = t.board.find((r) => r.qid === "q01")!;
    expect(row.slots.map((s) => s.state)).toEqual(["answered", "empty", "empty", "empty"]);
    expect(row.slots.map((s) => s.engine)).toEqual(["chatgpt", "claude", "gemini", "perplexity"]);
  });
  it("a failed answer reads as flagged, never present/absent", () => {
    const row = t.board.find((r) => r.qid === "q10")!;
    expect(row.slots[0].state).toBe("flagged");
  });
  it("counts answers in but no verdicts yet", () => {
    expect(t.counters.answersIn).toBe(3);
    expect(t.counters.expectedTotal).toBe(24);
    expect(t.counters.verdictsIn).toBe(0);
    expect(t.counters.mentions).toBeNull();
  });
  it("spotlights the newest answer that returned text (skips the failed one)", () => {
    // q10 (chatgpt) is newest but failed with no excerpt → q02 wins
    expect(t.spotlight?.qid).toBe("q02");
    expect(t.spotlight?.engineLabel).toBe("ChatGPT");
    expect(t.spotlight?.hosts).toEqual(["trackflow.example"]); // www stripped + deduped
  });
});

describe("deriveTheater — judge overlay", () => {
  const answers: TheaterAnswer[] = [
    ans({ qid: "q01", engine: "chatgpt", brand_present: true }),
    ans({ qid: "q01", engine: "claude", brand_present: false }),
    ans({ qid: "q01", engine: "gemini", brand_present: true }),
    ans({ qid: "q01", engine: "perplexity", brand_present: null }), // not judged yet
  ];
  const t = deriveTheater({
    questions: QSET,
    answers,
    stage: "Reading the answers",
    status: "running",
    profile: "smoke",
  });
  it("detects the judge phase from the off-list stage label", () => {
    expect(t.phase).toBe("judge");
  });
  it("paints each filled slot with its verdict state", () => {
    const row = t.board.find((r) => r.qid === "q01")!;
    expect(row.slots.map((s) => s.state)).toEqual(["present", "absent", "present", "answered"]);
  });
  it("counts verdicts and brand mentions from data actually present", () => {
    expect(t.counters.verdictsIn).toBe(3); // three judged
    expect(t.counters.mentions).toBe(2); // brand present in two
  });
});

describe("deriveTheater — malformed / missing verdict is graceful", () => {
  it("treats a null brand_present as merely answered, never crashes", () => {
    const t = deriveTheater({
      questions: QSET,
      answers: [ans({ qid: "q18", engine: "claude", brand_present: null })],
      stage: "Reading the answers",
      status: "running",
      profile: "smoke",
    });
    expect(t.board[0].slots[1].state).toBe("answered");
    expect(t.counters.mentions).toBeNull();
  });
  it("tolerates junk / missing citation urls without throwing", () => {
    const t = deriveTheater({
      questions: QSET,
      answers: [
        ans({
          qid: "q01",
          engine: "gemini",
          citations: [{ url: null }, { title: "no url" }, { url: "not a url" }],
        }),
      ],
      stage: "Asking Gemini · 1/6 answered",
      status: "running",
      profile: "smoke",
    });
    expect(t.spotlight?.qid).toBe("q01");
    expect(Array.isArray(t.spotlight?.hosts)).toBe(true);
  });
});

describe("deriveTheater — question_set absent falls back", () => {
  it("is inactive so the run view keeps its classic stage checklist", () => {
    const t = deriveTheater({
      questions: null,
      answers: [ans({ qid: "q01", engine: "chatgpt" })],
      stage: "Asking ChatGPT · 1/6 answered",
      status: "running",
      profile: "smoke",
    });
    expect(t.active).toBe(false);
    expect(t.board).toEqual([]);
    // counters still compute — the fallback view may show them if it wants
    expect(t.counters.answersIn).toBe(1);
  });
  it("empty question array is treated the same as absent", () => {
    const t = deriveTheater({ questions: [], answers: [], stage: "", status: "running" });
    expect(t.active).toBe(false);
  });
});

describe("deriveTheater — expectedTotal prefers the live stage denominator", () => {
  it("reads the count from a full-run observe stage even without profile", () => {
    const t = deriveTheater({
      questions: QSET,
      answers: [ans({ qid: "q01", engine: "chatgpt" })],
      stage: "Asking Claude · 12/20 answered",
      status: "running",
      profile: null,
    });
    expect(t.counters.expectedTotal).toBe(80); // 20 × 4
  });
});
