// `saylent export` over the Kestrel sample: every table as CSV, one table as
// JSON on stdout, a brand-history folder, a crawlers.json, and the refusals.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXPORT_COLUMNS, EXPORT_TABLES } from "@saylent/report/data-export";
import { bundlePathsFor, readCrawlerReport, run } from "./export";

const SAMPLE = path.resolve(__dirname, "../../../../examples/kestrel/run.json");

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((c: string) => (out.push(String(c)), true)) as typeof process.stdout.write;
  process.stderr.write = ((c: string) => (err.push(String(c)), true)) as typeof process.stderr.write;
  return { out, err, restore: () => ((process.stdout.write = o), (process.stderr.write = e)) };
}

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "saylent-export-"));

describe("saylent export", { timeout: 60_000 }, () => {
  it("writes one CSV per table with the documented header row", async () => {
    const out = tmp();
    const c = capture();
    const code = await run([SAMPLE, "--out", out]);
    c.restore();
    expect(code).toBe(0);
    for (const t of EXPORT_TABLES) {
      const csv = readFileSync(path.join(out, `${t}.csv`), "utf8");
      expect(csv.split("\r\n")[0]).toBe(EXPORT_COLUMNS[t].join(","));
    }
    expect(c.out.join("")).toContain("saylent.export/v1");
  });

  it("prints one table as JSON on stdout", async () => {
    const c = capture();
    const code = await run([SAMPLE, "--format", "json", "--table", "opportunities", "--stdout"]);
    c.restore();
    expect(code).toBe(0);
    const doc = JSON.parse(c.out.join(""));
    expect(Object.keys(doc.tables)).toEqual(["opportunities"]);
    expect(doc.tables.opportunities[0].rank).toBe(1);
  });

  it("reads a brand folder of dated runs as a history, oldest first", async () => {
    const dir = tmp();
    for (const d of ["2026-10-01", "2026-09-01"]) {
      mkdirSync(path.join(dir, d));
      copyFileSync(SAMPLE, path.join(dir, d, "run.json"));
    }
    expect(bundlePathsFor(dir).map((p) => path.basename(path.dirname(p)))).toEqual(["2026-09-01", "2026-10-01"]);
  });

  it("adds a crawlers.json and refuses anything else", () => {
    const dir = tmp();
    const good = path.join(dir, "crawlers.json");
    writeFileSync(good, JSON.stringify({ schema_version: 1, window: { from: null, to: null }, bots: [] }));
    expect(readCrawlerReport(good).bots).toEqual([]);
    const bad = path.join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ hello: 1 }));
    expect(() => readCrawlerReport(bad)).toThrow(/not a crawlers.json/);
  });

  it("refuses CSV on stdout without a table, an unknown table and a bad format", async () => {
    for (const args of [["--stdout"], ["--table", "users"], ["--format", "xml"]]) {
      const c = capture();
      const code = await run([SAMPLE, ...args]);
      c.restore();
      expect(code).toBe(1);
    }
    expect(existsSync(path.join(process.cwd(), "saylent-export", "users.csv"))).toBe(false);
  });
});
