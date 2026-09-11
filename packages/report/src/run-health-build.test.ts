// Colocated unit test for buildRunHealth (the pipeline's run-health assembly).
// Cases mirror the contract's grade rules: healthy, engine-dead, artifact-starved
// (the historical Mailforge bug shape), judge parse-failures, weak.
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_FAILURE_PREFIX,
  buildRunHealth,
  type BuildRunHealthInputs,
  type HealthAnswerInput,
  type HealthVerdictInput,
} from "./run-health-build";

const ENGINES = ["chatgpt", "claude", "gemini", "perplexity"];

/** a healthy judged verdict: brand recommended, first, positive, with claims + rivals */
const goodVerdict: HealthVerdictInput = {
  brand_present: true,
  mention_type: "recommended",
  prominence: "first",
  sentiment: "positive",
  claims: 2,
  other_brands: 3,
};

/** the parse-fallback signature for a PRESENT brand */
const fallbackVerdict: HealthVerdictInput = {
  brand_present: true,
  mention_type: "neutral",
  prominence: "buried",
  sentiment: "neutral",
  claims: 0,
  other_brands: 0,
};

function answersFor(
  engines: string[],
  qids: string[],
  opts: { citations?: number; verdict?: HealthVerdictInput | null; ok?: boolean } = {},
): HealthAnswerInput[] {
  const rows: HealthAnswerInput[] = [];
  for (const engine of engines) {
    for (const qid of qids) {
      rows.push({
        qid,
        engine,
        ok: opts.ok ?? true,
        citations: opts.citations ?? 2,
        verdict: opts.verdict === undefined ? goodVerdict : opts.verdict,
      });
    }
  }
  return rows;
}

function base(over: Partial<BuildRunHealthInputs> = {}): BuildRunHealthInputs {
  return {
    status: "done",
    isAudit: true,
    engines: ENGINES,
    answers: answersFor(ENGINES, ["q01", "q02", "q03"]),
    fixes: [
      { fixKey: "coverage-hub", weight: 7.6, artifact: "# hub artifact\nreal content" },
      { fixKey: "source-a.com", weight: 8.5, artifact: "pitch email real" },
      { fixKey: "source-b.com", weight: 8.4, artifact: "pitch email real" },
    ],
    draftTop: 5,
    corpus: [
      { fetch_status: 200, thin: false },
      { fetch_status: 200, thin: false },
    ],
    scores: { answered: 6, recommended: 4, rec_rate: 4 / 6 },
    estCostUsd: 1.23,
    durationS: 320,
    ...over,
  };
}

describe("buildRunHealth", () => {
  it("healthy run grades ok", () => {
    const h = buildRunHealth(base());
    expect(h.grade).toBe("ok");
    expect(h.v).toBe(1);
    expect(h.answers.chatgpt).toEqual({ got: 3, expected: 3 });
    expect(h.artifacts).toEqual({ planned: 3, drafted: 3 });
    expect(h.zero_citation_answers).toBe(0);
    expect(h.judge_parse_failures).toBe(0);
    expect(h.corpus).toEqual({ fetched: 2, fetch_failures: 0, thin: 0 });
    expect(h.notes).toEqual([]);
  });

  it("a dead engine (0 rows while others answer) grades degraded", () => {
    // gemini saved nothing; the other three answered all 3 questions.
    const h = buildRunHealth(
      base({ answers: answersFor(["chatgpt", "claude", "perplexity"], ["q01", "q02", "q03"]) }),
    );
    expect(h.grade).toBe("degraded");
    expect(h.answers.gemini).toEqual({ got: 0, expected: 3 });
    expect(h.notes.some((n) => n.includes("gemini") && n.includes("dead engine"))).toBe(true);
  });

  it("a partial engine (under half its expected answers) grades degraded", () => {
    // The Mailforge full-run shape: gemini answered 1 of 3 while the others were
    // full — a paid run with a mostly-dead engine is not "ok".
    const h = buildRunHealth(
      base({
        answers: [
          ...answersFor(["chatgpt", "claude", "perplexity"], ["q01", "q02", "q03"]),
          ...answersFor(["gemini"], ["q01"]),
        ],
      }),
    );
    expect(h.grade).toBe("degraded");
    expect(h.answers.gemini).toEqual({ got: 1, expected: 3 });
    expect(h.notes.some((n) => n.includes("gemini") && n.includes("partial engine"))).toBe(true);
  });

  it("artifact starvation (the Mailforge bug shape) grades degraded", () => {
    // coverage-hub is LOWER weight than the source pitches, so under the old rule it
    // shipped empty. It still claims a slot (planned includes it) but has no artifact
    // -> drafted < planned -> degraded.
    const fixes = [
      { fixKey: "source-a.com", weight: 8.6, artifact: "real" },
      { fixKey: "source-b.com", weight: 8.5, artifact: "real" },
      { fixKey: "source-c.com", weight: 8.4, artifact: "real" },
      { fixKey: "source-d.com", weight: 8.3, artifact: "real" },
      { fixKey: "coverage-hub", weight: 7.6, artifact: null },
      { fixKey: "schema_missing", weight: 5.5, artifact: null },
    ];
    const h = buildRunHealth(base({ fixes, draftTop: 5 }));
    expect(h.artifacts).toEqual({ planned: 5, drafted: 4 });
    expect(h.grade).toBe("degraded");
    expect(h.notes.some((n) => n.includes("artifact starvation"))).toBe(true);
  });

  it("counts a failed-placeholder artifact as NOT drafted", () => {
    const fixes = [
      { fixKey: "coverage-hub", weight: 9, artifact: "real hub" },
      { fixKey: "source-a.com", weight: 8, artifact: `${ARTIFACT_FAILURE_PREFIX} — retry the run to draft it.]` },
    ];
    const h = buildRunHealth(base({ fixes, draftTop: 5 }));
    expect(h.artifacts).toEqual({ planned: 2, drafted: 1 });
    expect(h.grade).toBe("degraded");
  });

  it("judge parse-failures (present-brand fallback shape) grade degraded", () => {
    const h = buildRunHealth(base({ answers: answersFor(ENGINES, ["q01", "q02", "q03"], { verdict: fallbackVerdict }) }));
    expect(h.judge_parse_failures).toBe(12);
    expect(h.grade).toBe("degraded");
  });

  it("does NOT flag absent-brand verdicts as parse-failures", () => {
    const absent: HealthVerdictInput = {
      brand_present: false,
      mention_type: "absent",
      prominence: "none",
      sentiment: "neutral",
      claims: 0,
      other_brands: 0,
    };
    // absent verdicts with citations present -> healthy, no parse-failure flag
    const h = buildRunHealth(base({ answers: answersFor(ENGINES, ["q01", "q02", "q03"], { verdict: absent }) }));
    expect(h.judge_parse_failures).toBe(0);
  });

  it("weak result (recommended <10% of scored) grades weak when otherwise healthy", () => {
    const h = buildRunHealth(base({ scores: { answered: 20, recommended: 1, rec_rate: 1 / 20 } }));
    expect(h.weak_result).toBe(true);
    expect(h.grade).toBe("weak");
    expect(h.notes.some((n) => n.includes("weak result"))).toBe(true);
  });

  it("weak_result is audit-only (verify never grades weak)", () => {
    const h = buildRunHealth(base({ isAudit: false, scores: { answered: 20, recommended: 1, rec_rate: 1 / 20 } }));
    expect(h.weak_result).toBe(false);
    expect(h.grade).toBe("ok");
  });

  it("zero-citation over 20% of judged answers grades degraded", () => {
    // all answers ok, all zero-citation -> ratio 1.0 > 0.2
    const h = buildRunHealth(base({ answers: answersFor(ENGINES, ["q01", "q02", "q03"], { citations: 0 }) }));
    expect(h.zero_citation_answers).toBe(12);
    expect(h.grade).toBe("degraded");
  });

  it("failed status grades failed with what is known", () => {
    const h = buildRunHealth(base({ status: "failed", answers: answersFor(["chatgpt"], ["q01"]) }));
    expect(h.grade).toBe("failed");
    expect(h.notes.some((n) => n.includes("failed state"))).toBe(true);
  });

  it("no answers at all grades failed", () => {
    const h = buildRunHealth(base({ answers: [] }));
    expect(h.grade).toBe("failed");
  });

  // Adaptive sampling must NOT distort the expected-question math.
  // assembleHealthFromDb reads only the CANONICAL answers table (one row per
  // (qid,engine)); per-sample draws live in answer_samples and never reach
  // buildRunHealth. So expected stays the distinct-qid count regardless of sampling.
  it("expected per engine = distinct canonical qids for the 23-question v2 set", () => {
    const qids = Array.from({ length: 23 }, (_, i) => `q${String(i + 1).padStart(2, "0")}`);
    const h = buildRunHealth(base({ answers: answersFor(ENGINES, qids) }));
    for (const engine of ENGINES) {
      expect(h.answers[engine]).toEqual({ got: 23, expected: 23 });
    }
    expect(h.grade).toBe("ok");
  });
});
