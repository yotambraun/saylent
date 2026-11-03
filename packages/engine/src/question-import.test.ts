// Question import: CSV edge cases, Search Console header variants, the Pages
// refusal, generic CSV mapping, text lines, every drop reason counted, ranking,
// dedupe and clustering, locale validation, the questions.json shape and the
// rewrite pairing.
import { describe, expect, it } from "vitest";
import {
  clusterKey,
  detectFormat,
  importQuestions,
  importSummary,
  isQuestionShaped,
  parseCsv,
  parseMetric,
  parseRewrite,
  previewQuestionImport,
  questionRewritePrompt,
  toQuestionsJson,
  validateLocale,
} from "./question-import";

const GSC = [
  "Top queries,Clicks,Impressions,CTR,Position",
  "best uptime monitoring tool,40,1200,3.33%,4.1",
  "uptime monitor for startups,12,800,1.5%,7.2",
  "kestrel uptime pricing,30,300,10%,1.2",
  "Best Uptime Monitoring Tool?,1,90,1.1%,9",
  "tool monitoring uptime best,2,50,4%,12",
  "status page,5,20,25%,3",
  "how to monitor ssl certificate expiry,3,1,300%,2",
].join("\n");

describe("CSV", () => {
  it("handles quotes, escaped quotes, CRLF, a BOM and sniffed delimiters", () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","he said ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv('a\n"multi\nline"')).toEqual([["a"], ["multi\nline"]]);
  });

  it("reads metrics with thousands separators and percentages", () => {
    expect(parseMetric("1,234")).toBe(1234);
    expect(parseMetric("4.5%")).toBe(4.5);
    expect(parseMetric("-")).toBe(0);
    expect(parseMetric("n/a")).toBeNull();
  });
});

describe("Search Console", () => {
  it("detects the export, ranks by impressions and counts every drop", () => {
    const r = importQuestions(GSC, { minImpressions: 10, exclude: ["kestrel"] }, "Queries.csv");
    expect(r.format).toBe("gsc");
    expect(r.column).toBe("Top queries");
    expect(r.kept.map((q) => q.text)).toEqual([
      "best uptime monitoring tool",
      "uptime monitor for startups",
      "tool monitoring uptime best",
      "status page",
    ]);
    expect(r.kept[0]).toMatchObject({ impressions: 1200, clicks: 40, position: 4.1 });
    expect(r.kept[0].ctr).toBeCloseTo(0.0333);
    expect(r.kept[0].variants).toEqual(["Best Uptime Monitoring Tool?"]);
    expect(r.dropped).toEqual({ excluded: 1, duplicate: 1, below_min_impressions: 1 });
    expect(importSummary(r)).toBe("Kept 4 of 7 rows: 1 matched --exclude, 1 below --min-impressions, 1 duplicates.");
  });

  it("clusters word-order variants into the strongest one", () => {
    const r = importQuestions(GSC, { cluster: true }, "Queries.csv");
    expect(r.kept.find((q) => q.text === "best uptime monitoring tool")?.variants).toEqual(["Best Uptime Monitoring Tool?", "tool monitoring uptime best"]);
    expect(r.dropped.clustered).toBe(1);
    expect(clusterKey("What is the best tool for uptime?")).toBe("best tool uptime");
  });

  it("accepts the Search Analytics API's column names, with CTR as a fraction", () => {
    const r = importQuestions("query,clicks,impressions,ctr,position\nuptime alerts slack,3,100,0.03,5", {});
    expect(r.format).toBe("gsc");
    expect(r.kept[0]).toMatchObject({ text: "uptime alerts slack", impressions: 100, ctr: 0.03 });
  });

  it("refuses the Pages tab with the file to use instead", () => {
    expect(() => importQuestions("Top pages,Clicks,Impressions,CTR,Position\nhttps://a.example/,1,2,50%,1", {})).toThrow(/Pages tab.*Queries\.csv/);
  });

  it("caps at --max and counts the rest", () => {
    const r = importQuestions(GSC, { max: 2 });
    expect(r.kept).toHaveLength(2);
    expect(r.dropped.over_max).toBe(4);
  });
});

describe("generic CSV and text", () => {
  it("maps a column by name or number and ranks by a weight column", () => {
    const csv = "id,Prompt,score\n1,which crm for agencies,2\n2,cheapest crm for freelancers,9\n3,x,1";
    const r = importQuestions(csv, { column: "prompt", weightColumn: "3" }, "prompts.csv");
    expect(r.format).toBe("csv");
    expect(r.kept.map((q) => q.text)).toEqual(["cheapest crm for freelancers", "which crm for agencies"]);
    expect(r.dropped.too_short).toBe(1);
    expect(() => importQuestions(csv, {}, "prompts.csv")).toThrow(/Pass --column/);
    expect(() => importQuestions(csv, { column: "nope" }, "prompts.csv")).toThrow(/not a column/);
  });

  it("reads text lines, skipping comments and blanks, and keeps question-shaped ones", () => {
    const text = "# my list\nWhat is the best CRM?\n\ncrm pricing comparison\nwelche crm ist am besten?\n";
    const r = importQuestions(text, { questionsOnly: true });
    expect(r.format).toBe("text");
    expect(r.kept.map((q) => q.text)).toEqual(["What is the best CRM?", "welche crm ist am besten?"]);
    expect(r.dropped).toEqual({ not_question: 1 });
    expect(isQuestionShaped("how do I monitor cron jobs")).toBe(true);
  });

  it("detects formats from content and file name", () => {
    expect(detectFormat('{"questions":[]}')).toBe("questions.json");
    expect(detectFormat("a,b\n1,2", "x.csv")).toBe("csv");
    expect(detectFormat("just a line")).toBe("text");
  });

  it("rejects a bad regular expression by flag", () => {
    expect(() => importQuestions("a b c", { include: ["("] })).toThrow(/--include "\(" is not a valid/);
  });
});

describe("locale and questions.json", () => {
  it("validates BCP 47 language and two-letter country", () => {
    expect(validateLocale("pt-BR", "BR")).toEqual({ language: "pt-BR", country: "br" });
    expect(validateLocale("portuguese", null)).toMatch(/BCP 47/);
    expect(validateLocale(null, "USA")).toMatch(/two-letter/);
    expect(() => importQuestions("a b", { country: "usa" })).toThrow(/two-letter/);
  });

  it("writes the questions.json audit --questions reads, with provenance and locale", () => {
    const r = importQuestions(GSC, { language: "en", country: "us", max: 2 }, "Queries.csv");
    const doc = toQuestionsJson(r, { file: "Queries.csv", type: "category", now: new Date("2026-11-02T00:00:00Z") });
    expect(doc.locale).toEqual({ language: "en", country: "us" });
    expect(doc.import).toMatchObject({ file: "Queries.csv", format: "gsc", rows: 7, kept: 2, generated_at: "2026-11-02T00:00:00.000Z" });
    expect(doc.questions[0]).toEqual({ id: "u01", type: "category", text: "best uptime monitoring tool", source: "user", impressions: 1200, clicks: 40 });
  });

  it("previews without writing", () => {
    const p = previewQuestionImport({ text: GSC, filename: "Queries.csv", options: { max: 3 } });
    expect(p.kept).toHaveLength(3);
    expect(p.summary).toMatch(/^Kept 3 of 7 rows/);
  });
});

describe("rewrite", () => {
  it("builds one prompt and pairs lines back only when they line up", () => {
    const qs = ["best crm agencies", "crm pricing"];
    expect(questionRewritePrompt(qs, "de")).toContain("language (de)");
    const ok = parseRewrite(qs, "1. What is the best CRM for agencies?\n2. How much does a CRM cost?");
    expect(ok.get("crm pricing")).toBe("How much does a CRM cost?");
    expect(parseRewrite(qs, "only one line").size).toBe(0);
    const doc = toQuestionsJson(importQuestions(qs.join("\n"), {}), { rewritten: ok });
    expect(doc.questions[0]).toMatchObject({ text: "What is the best CRM for agencies?", from: "best crm agencies" });
  });
});
