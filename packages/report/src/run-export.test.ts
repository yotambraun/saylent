import { describe, expect, it } from "vitest";
import {
  answerCsvRows,
  buildRunExportJson,
  citationUrls,
  exportFilename,
  slugifyBrand,
  summarizeCorpus,
  toCsv,
  CSV_HEADERS,
  type ExportAnswer,
  type RunExportInput,
} from "./run-export";

const answer = (over: Partial<ExportAnswer> = {}): ExportAnswer => ({
  qid: "q1",
  question: "Best contact-data platform?",
  engine: "chatgpt",
  qtype: "category",
  verdict: { brand_present: true, mention_type: "recommended", prominence: "primary", sentiment: "positive" },
  citations: [{ url: "https://a.com", title: "A" }, { url: "https://b.com" }],
  ...over,
});

describe("citationUrls", () => {
  it("keeps order and drops empties/nulls", () => {
    expect(
      citationUrls([{ url: "https://a.com" }, { url: "  " }, { url: null }, { url: "https://c.com" }]),
    ).toEqual(["https://a.com", "https://c.com"]);
  });
  it("handles null citations", () => {
    expect(citationUrls(null)).toEqual([]);
  });
});

describe("answerCsvRows", () => {
  it("flattens one row per answer in header order", () => {
    const [row] = answerCsvRows([answer()]);
    expect(row).toEqual([
      "q1",
      "Best contact-data platform?",
      "chatgpt",
      "recommended",
      "primary",
      "positive",
      "https://a.com | https://b.com",
    ]);
    expect(row.length).toBe(CSV_HEADERS.length);
  });
  it("tolerates a null verdict", () => {
    const [row] = answerCsvRows([answer({ verdict: null, citations: [] })]);
    expect(row).toEqual(["q1", "Best contact-data platform?", "chatgpt", "", "", "", ""]);
  });
});

describe("toCsv", () => {
  it("escapes commas, quotes and newlines per RFC 4180", () => {
    const csv = toCsv(["a", "b"], [["plain", 'has,comma'], ['has"quote', "line\nbreak"]]);
    expect(csv).toBe(
      'a,b\r\n' + 'plain,"has,comma"\r\n' + '"has""quote","line\nbreak"',
    );
  });
});

describe("summarizeCorpus", () => {
  it("counts totals, cited and opportunity pages by type", () => {
    const s = summarizeCorpus([
      { page_type: "blog", cited_by: ["chatgpt"], opportunity: true },
      { page_type: "blog", cited_by: [], opportunity: false },
      { page_type: "docs", cited_by: null, opportunity: true },
    ]);
    expect(s).toEqual({
      total_pages: 3,
      cited_pages: 1,
      opportunity_pages: 2,
      by_type: { blog: 2, docs: 1 },
    });
  });
});

describe("buildRunExportJson", () => {
  const input: RunExportInput = {
    run: {
      id: "r1",
      kind: "audit",
      profile: "full",
      status: "done",
      created_at: "2026-07-01T00:00:00Z",
      finished_at: "2026-07-01T00:10:00Z",
      est_cost_usd: 1.23,
    },
    brand: { name: "Acme Co", domain: "acme.com" },
    scores: { overall: { recommended: 3, answered: 10 } },
    answers: [answer()],
    fixes: [
      { fix_key: "k1", title: "Add pricing schema", factor: "schema", weight: 0.8, effort: "low", evidence: ["e1"], artifact: "<html>" },
    ],
    corpus: [{ page_type: "blog", cited_by: ["chatgpt"], opportunity: true }],
  };

  it("projects verdict fields and citations onto each answer", () => {
    const doc = buildRunExportJson(input);
    expect(doc.export_format).toBe("saylent.run-export/v1");
    expect(doc.run.id).toBe("r1");
    expect(doc.brand).toEqual({ name: "Acme Co", domain: "acme.com" });
    expect(doc.answers[0]).toMatchObject({
      qid: "q1",
      engine: "chatgpt",
      mention_type: "recommended",
      prominence: "primary",
      sentiment: "positive",
    });
    expect(doc.answers[0].citations).toEqual([
      { url: "https://a.com", title: "A" },
      { url: "https://b.com", title: null },
    ]);
    expect(doc.fixes[0]).toMatchObject({ title: "Add pricing schema", weight: 0.8, artifact: "<html>" });
    expect(doc.corpus_summary.total_pages).toBe(1);
  });
});

describe("filename helpers", () => {
  it("slugifies brand names", () => {
    expect(slugifyBrand("Acme Co!")).toBe("acme-co");
    expect(slugifyBrand("   ")).toBe("brand");
  });
  it("builds a dated, sortable filename", () => {
    expect(exportFilename("Acme Co", new Date("2026-07-21T12:00:00Z"), "csv")).toBe(
      "saylent-acme-co-2026-07-21.csv",
    );
    expect(exportFilename("Acme Co", new Date("2026-07-21T12:00:00Z"), "json")).toBe(
      "saylent-acme-co-2026-07-21.json",
    );
  });
});
