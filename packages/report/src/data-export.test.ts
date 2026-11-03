import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBundle, type RunBundleV1 } from "@saylent/engine/bundle";
import type { CrawlerReport } from "@saylent/engine/crawler-analytics";
import {
  EXPORT_COLUMNS,
  EXPORT_FORMAT,
  EXPORT_TABLES,
  buildDataExport,
  csvCell,
  isExportTable,
  tableCsv,
} from "./data-export";

const kestrel = (): RunBundleV1 =>
  readBundle(JSON.parse(readFileSync(path.resolve(__dirname, "../../../examples/kestrel/run.json"), "utf8")));

describe("export columns are a versioned contract", () => {
  it("pins the v1 tables and their column order", () => {
    // Changing a column name or order is a breaking change: bump
    // EXPORT_SCHEMA_VERSION and the docs page (website/content/docs/export.mdx) with it.
    expect(EXPORT_FORMAT).toBe("saylent.export/v1");
    expect(EXPORT_TABLES).toEqual(["runs", "answers", "citations", "sources", "opportunities", "share_of_voice", "fixes", "crawlers", "search_queries", "ai_referrals"]);
    expect(EXPORT_COLUMNS.answers.slice(0, 8)).toEqual(["run_id", "run_date", "qid", "qtype", "question", "engine", "engine_label", "status"]);
    // 0.2.0 additions are at the END, so v1 readers keep working
    expect(EXPORT_COLUMNS.answers.slice(-2)).toEqual(["answer_text", "search_queries"]);
    expect(EXPORT_COLUMNS.search_queries).toEqual(["run_id", "run_date", "qid", "engine", "sample", "position", "query"]);
    expect(EXPORT_COLUMNS.opportunities).toContain("receipts");
  });

  it("every documented column is on the docs page", () => {
    const page = readFileSync(path.resolve(__dirname, "../../../website/content/docs/export.mdx"), "utf8");
    for (const t of EXPORT_TABLES) {
      expect(page, `table ${t}`).toContain(`\`${t}\``);
      for (const c of EXPORT_COLUMNS[t]) expect(page, `${t}.${c}`).toContain(`\`${c}\``);
    }
  });
});

describe("buildDataExport on the Kestrel sample", () => {
  const doc = buildDataExport({ bundles: [kestrel()], now: new Date("2026-11-02T00:00:00Z") });

  it("has one row per answer and per citation, every row in column order", () => {
    const b = kestrel();
    expect(doc.tables.runs).toHaveLength(1);
    expect(doc.tables.answers).toHaveLength(b.answers.length);
    expect(doc.tables.citations).toHaveLength(b.citations.length);
    expect(doc.tables.fixes).toHaveLength(b.fixes.length);
    for (const t of EXPORT_TABLES) {
      for (const row of doc.tables[t]) expect(Object.keys(row)).toEqual([...EXPORT_COLUMNS[t]]);
    }
  });

  it("counts match the bundle's own scores and source intelligence", () => {
    const b = kestrel();
    expect(doc.tables.runs[0].recommended).toBe(b.scores?.overall.recommended);
    expect(doc.tables.opportunities.length).toBeGreaterThan(0);
    expect(doc.tables.opportunities[0].rank).toBe(1);
    const brand = doc.tables.share_of_voice.find((r) => r.is_brand && r.scope === "all");
    expect(brand?.name).toBe("Kestrel Uptime");
    // every opportunity carries receipts as qid:engine handles
    for (const o of doc.tables.opportunities) {
      expect((o.receipts as string[]).every((r) => /^q\d+:[a-z_]+$/.test(r))).toBe(true);
    }
  });

  it("leaves crawlers empty without a report and says so", () => {
    expect(doc.tables.crawlers).toEqual([]);
    expect(doc.notes.join(" ")).toContain("crawlers.json");
  });

  it("writes CSV with the header row and lists joined", () => {
    const csv = tableCsv(doc, "answers");
    expect(csv.split("\r\n")[0]).toBe(EXPORT_COLUMNS.answers.join(","));
    expect(csvCell(["a", "b"])).toBe("a | b");
    expect(csvCell(null)).toBe("");
  });
});

describe("crawler rows", () => {
  it("maps bots and leaves verification null when IP checks were off", () => {
    const report = {
      window: { from: "2026-10-01", to: "2026-10-31" },
      ipVerification: { mode: "off", sources: [], note: "" },
      bots: [
        {
          id: "gptbot", label: "GPTBot", operator: "OpenAI", purpose: "training", ai: true, registryVerified: true, docsUrl: null,
          hits: 12, distinctPages: 4, status: { "2xx": 12, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 }, blocked: 0, errors: 0, notFound: 0,
          firstSeen: "2026-10-02", lastSeen: "2026-10-30", verification: { verified: 0, unverified: 12 }, topPages: [],
        },
      ],
    } as unknown as CrawlerReport;
    const doc = buildDataExport({ bundles: [], crawlers: report });
    expect(doc.tables.crawlers).toEqual([
      expect.objectContaining({ bot_id: "gptbot", requests: 12, pages: 4, verified: null, window_from: "2026-10-01" }),
    ]);
  });

  it("adds ai_referrals from a crawler report that counted them, and says why it is empty otherwise", () => {
    const base = { window: { from: "2026-10-01", to: "2026-10-31" }, ipVerification: { mode: "off", sources: [], note: "" }, bots: [] };
    const withRefs = {
      ...base,
      referrals: {
        visits: 3,
        listChecked: "2026-11-02",
        note: "a floor",
        assistants: [
          { id: "chatgpt", label: "ChatGPT", operator: "OpenAI", visits: 3, viaReferrer: 2, viaUtmSource: 1, pages: [{ path: "/pricing", visits: 3 }], firstSeen: "2026-10-02", lastSeen: "2026-10-30", receipts: [] },
        ],
      },
    } as unknown as CrawlerReport;
    const doc = buildDataExport({ bundles: [], crawlers: withRefs });
    expect(doc.tables.ai_referrals).toEqual([
      {
        window_from: "2026-10-01", window_to: "2026-10-31", assistant_id: "chatgpt", assistant: "ChatGPT", operator: "OpenAI",
        visits: 3, via_referrer: 2, via_utm_source: 1, top_pages: ["/pricing (3)"], first_seen: "2026-10-02", last_seen: "2026-10-30",
      },
    ]);
    expect(doc.notes.join(" ")).toMatch(/ai_referrals is a floor/);
    const older = buildDataExport({ bundles: [], crawlers: base as unknown as CrawlerReport });
    expect(older.tables.ai_referrals).toEqual([]);
    expect(older.notes.join(" ")).toMatch(/made before referrals were counted/);
  });
});

describe("search_queries", () => {
  it("one row per query per draw; null on answers from engines that do not report them", () => {
    const b = kestrel();
    const chat = b.answers.find((a) => a.engine === "chatgpt")!;
    chat.search_queries = ["best uptime monitoring", "kestrel uptime pricing"];
    chat.samples = [];
    const multi = b.answers.find((a) => a.engine === "claude")!;
    multi.search_queries = ["q from draw 1"];
    multi.samples = [
      { runId: b.run.id, qid: multi.qid, engine: multi.engine, sampleIdx: 0, raw_text: "", citations: [], verdict: null, usage: null, search_queries: [] },
      { runId: b.run.id, qid: multi.qid, engine: multi.engine, sampleIdx: 1, raw_text: "", citations: [], verdict: null, usage: null, search_queries: ["q from draw 1"] },
    ];
    const doc = buildDataExport({ bundles: [b], now: new Date("2026-11-02T00:00:00Z") });
    const rows = doc.tables.search_queries;
    expect(rows.filter((r) => r.qid === chat.qid && r.engine === "chatgpt").map((r) => [r.sample, r.position, r.query])).toEqual([
      [0, 1, "best uptime monitoring"],
      [0, 2, "kestrel uptime pricing"],
    ]);
    expect(rows.filter((r) => r.qid === multi.qid && r.engine === "claude").map((r) => [r.sample, r.query])).toEqual([[1, "q from draw 1"]]);
    const answerRow = doc.tables.answers.find((r) => r.qid === chat.qid && r.engine === "chatgpt")!;
    expect(answerRow.search_queries).toEqual(["best uptime monitoring", "kestrel uptime pricing"]);
    const other = doc.tables.answers.find((r) => r.engine === "perplexity");
    if (other) expect(other.search_queries).toBeNull();
    expect(tableCsv(doc, "search_queries").split("\r\n")[0]).toBe("run_id,run_date,qid,engine,sample,position,query");
  });

  it("is empty for a run recorded before 0.2.0", () => {
    const doc = buildDataExport({ bundles: [kestrel()], now: new Date("2026-11-02T00:00:00Z") });
    expect(doc.tables.search_queries).toEqual([]);
    expect(doc.tables.answers.every((r) => r.search_queries === null)).toBe(true);
  });
});

describe("isExportTable", () => {
  it("accepts only documented tables", () => {
    expect(isExportTable("answers")).toBe(true);
    expect(isExportTable("users")).toBe(false);
  });
});
