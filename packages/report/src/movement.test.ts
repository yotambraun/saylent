import { describe, expect, it } from "vitest";
import { buildMovement, type MovementSide } from "./movement";

const brand = { name: "Acme Cloud", domain: "acmecloud.example", aliases: ["Acme Cloud", "Acme"] };

function answer(qid: string, engine: string, mention: string, text: string, present = false) {
  return {
    qid,
    engine,
    question: `q ${qid}`,
    raw_text: text,
    verdict: { mention_type: mention, brand_present: present },
  };
}

const baseline: MovementSide = {
  runId: "run-base",
  finishedAt: "2026-09-01T00:00:00Z",
  scores: {
    overall: { answered: 8, recommended: 1, mentioned: 2 },
    per_engine: {
      chatgpt: { answered: 4, recommended: 1, mentioned: 1 },
      claude: { answered: 4, recommended: 0, mentioned: 1 },
    },
  },
  answers: [
    answer("q01", "chatgpt", "absent", "Use Nimbus for this. Nimbus is the standard."),
    answer("q02", "chatgpt", "listed", "Options include Nimbus and Acme Cloud."),
  ],
  fixes: [{ fix_key: "add-comparison-page", published_at: "2026-09-03T00:00:00Z" }],
};

const current: MovementSide = {
  runId: "run-verify",
  finishedAt: "2026-09-08T00:00:00Z",
  scores: {
    overall: { answered: 8, recommended: 3, mentioned: 4 },
    per_engine: {
      chatgpt: { answered: 4, recommended: 3, mentioned: 2 },
      claude: { answered: 4, recommended: 0, mentioned: 2 },
    },
    verify: {
      baseline: {
        overall: { answered: 8, recommended: 1, mentioned: 2 },
        per_engine: {
          chatgpt: { answered: 4, recommended: 1, mentioned: 1 },
          claude: { answered: 4, recommended: 0, mentioned: 1 },
        },
      },
      watch_notes: [
        {
          fixKey: "add-comparison-page",
          title: "Publish the comparison page",
          note: "q01 now names you on ChatGPT.",
          newlyPresentQids: ["q01"],
        },
      ],
    },
  },
  answers: [
    answer("q01", "chatgpt", "recommended", "Acme Cloud is the one to pick here.", true),
    answer("q02", "chatgpt", "listed", "Options include Nimbus and Acme Cloud."),
  ],
};

describe("buildMovement", () => {
  it("reads before/after off the verify baseline the run carries", () => {
    const m = buildMovement({ brand, baseline, current });
    expect(m.before).toBe(1);
    expect(m.after).toBe(3);
    expect(m.withinNoise).toBe(false);
    expect(m.questionCount).toBe(4);
  });

  it("lists only the answers whose mention type actually changed", () => {
    const m = buildMovement({ brand, baseline, current });
    const chatgpt = m.rows.find((r) => r.engine === "chatgpt")!;
    expect(chatgpt.changes.map((c) => c.qid)).toEqual(["q01"]);
    expect(chatgpt.changes[0]).toMatchObject({ before: "absent", after: "recommended" });
    // the sentence receipt: the line the engine added names the brand
    expect(chatgpt.changes[0].entered[0]?.mentionsBrand).toBe(true);
  });

  it("calls a swing of one inside normal variation", () => {
    const quiet = structuredClone(current);
    quiet.scores!.overall!.recommended = 2;
    const m = buildMovement({ brand, baseline, current: quiet });
    expect(m.withinNoise).toBe(true);
  });

  it("attributes the one celebration to a single engine when only one moved", () => {
    const m = buildMovement({ brand, baseline, current });
    expect(m.celebration).toEqual({
      fixKey: "add-comparison-page",
      line: "That fix worked. ChatGPT now cites you.",
    });
  });

  it("carries the shipped date from the baseline run's fixes", () => {
    const m = buildMovement({ brand, baseline, current });
    expect(m.watchNotes[0]).toMatchObject({ moved: true, shippedAt: "2026-09-03T00:00:00Z" });
  });

  it("refuses to claim movement when the question set was not the same", () => {
    const drifted = structuredClone(current);
    drifted.answers.push(answer("q09", "chatgpt", "absent", "A question that did not exist."));
    const m = buildMovement({ brand, baseline, current: drifted });
    expect(m.comparable).toBe(false);
    // and with no comparable set, no per-answer change is asserted
    expect(m.rows.every((r) => r.changes.length === 0)).toBe(true);
  });

  it("flags an engine that answered nothing this run", () => {
    const partial = structuredClone(current);
    partial.scores!.per_engine!.claude = { answered: 0, recommended: 0, mentioned: 0 };
    const m = buildMovement({ brand, baseline, current: partial });
    expect(m.rows.find((r) => r.engine === "claude")!.flagged).toBe(true);
    expect(m.rows.find((r) => r.engine === "chatgpt")!.flagged).toBe(false);
  });
});
