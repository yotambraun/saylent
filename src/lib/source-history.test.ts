// "Sources over time": per-run grouping, overrides, the empty states, and the
// count-only display rows. The engine's own source arithmetic is pinned in
// packages/engine/src/sources.test.ts; this suite pins the app's shaping.
import { describe, expect, it } from "vitest";
import {
  buildBrandSourceHistory,
  opportunityBadge,
  pickSourceHistoryRuns,
  readSourceOverrides,
  SOURCE_HISTORY_MAX_RUNS,
  type SourceHistoryAnswerRow,
} from "./source-history";

const brand = { name: "Acme Monitor", domain: "acme.example", aliases: ["Acme"], competitors: ["Rivalry"] };

const absent = (rival: string) => ({
  brand_present: false,
  mention_type: "absent",
  other_brands: [{ name: rival, why: "" }],
  excerpt: "",
});
const present = { brand_present: true, mention_type: "recommended", other_brands: [], excerpt: "Acme is good" };

function answer(run_id: string, over: Partial<SourceHistoryAnswerRow> = {}): SourceHistoryAnswerRow {
  return {
    run_id,
    qid: "q01",
    engine: "chatgpt",
    qtype: "category",
    question: "best uptime monitor?",
    ok: true,
    citations: [{ url: "https://listsite.example/best-uptime" }],
    verdict: absent("Rivalry"),
    ...over,
  };
}

const runs = [
  { id: "r2", created_at: "2026-10-01T00:00:00Z" },
  { id: "r1", created_at: "2026-09-01T00:00:00Z" },
];

describe("buildBrandSourceHistory", () => {
  it("folds each run's answers into per-run citation counts, oldest run first", () => {
    const res = buildBrandSourceHistory({
      brand,
      runs,
      answers: [
        answer("r1"),
        answer("r2"),
        answer("r2", { qid: "q02", engine: "google_ai_mode", citations: [{ url: "https://listsite.example/x" }] }),
        answer("r2", { qid: "q03", verdict: present, citations: [{ url: "https://acme.example/docs" }] }),
      ],
      corpus: [],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { view } = res;
    expect(view.runs.map((r) => r.runId)).toEqual(["r1", "r2"]);
    expect(view.latestRunId).toBe("r2");
    const list = view.domains.find((d) => d.host === "listsite.example");
    expect(list?.citations).toEqual([1, 2]);
    expect(list?.total).toBe(3);
    // cited by rival-won answers in both runs, and not the brand's or a rival's site
    expect(list?.opportunityRuns).toBe(2);
    expect(view.domains.find((d) => d.host === "acme.example")?.typeLabel).toBe("Your site");
    const brandVoice = view.voice.find((v) => v.isBrand);
    expect(brandVoice?.named).toEqual([0, 1]);
    expect(view.voice.find((v) => v.name === "Rivalry")?.named).toEqual([1, 2]);
  });

  it("applies the brand's source-type overrides", () => {
    const res = buildBrandSourceHistory({
      brand,
      runs: [runs[1]],
      answers: [answer("r1")],
      corpus: [],
      overrides: { domainTypes: { "listsite.example": "review_site" } },
    });
    expect(res.ok && res.view.domains[0]).toMatchObject({ host: "listsite.example", type: "review_site", typeLabel: "Review site" });
  });

  it("says why it is empty: no finished run, or runs that cite nothing", () => {
    expect(buildBrandSourceHistory({ brand, runs: [], answers: [], corpus: [] })).toEqual({ ok: false, reason: "no_runs" });
    expect(
      buildBrandSourceHistory({ brand, runs, answers: [answer("r1", { citations: [] })], corpus: [] }),
    ).toEqual({ ok: false, reason: "no_citations" });
  });
});

describe("pickSourceHistoryRuns", () => {
  it("keeps the newest runs, oldest first", () => {
    const many = Array.from({ length: SOURCE_HISTORY_MAX_RUNS + 2 }, (_, i) => ({
      id: `r${i}`,
      created_at: `2026-0${(i % 9) + 1}-01T00:00:00Z`,
    }));
    const picked = pickSourceHistoryRuns(many);
    expect(picked).toHaveLength(SOURCE_HISTORY_MAX_RUNS);
    expect(picked[0].id).toBe("r2");
    expect(picked[picked.length - 1].id).toBe(`r${SOURCE_HISTORY_MAX_RUNS + 1}`);
  });
});

describe("readSourceOverrides / opportunityBadge", () => {
  it("reads the stored map defensively", () => {
    expect(readSourceOverrides({ sourceOverrides: { domainTypes: { "g2.com": "review_site" } } })).toEqual({
      domainTypes: { "g2.com": "review_site" },
    });
    expect(readSourceOverrides({ sourceOverrides: { domainTypes: {} } })).toBeNull();
    expect(readSourceOverrides(null)).toBeNull();
    expect(readSourceOverrides({ sourceOverrides: { domainTypes: ["x"] } })).toBeNull();
  });

  it("counts, never percentages", () => {
    expect(opportunityBadge(0, 3)).toBeNull();
    expect(opportunityBadge(2, 3)).toBe("opportunity in 2 of 3 runs");
    expect(opportunityBadge(1, 1)).toBe("off-site opportunity");
  });
});
