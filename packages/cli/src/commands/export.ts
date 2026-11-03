// `saylent export <run.json…>` — data out, $0 and offline. Turns run bundles
// (and optionally a crawlers.json) into the documented, versioned tables of
// @saylent/report/data-export: runs, answers, citations, sources,
// opportunities, share_of_voice, fixes, crawlers and search_queries. CSV writes one file per
// table; JSON writes one export.json. The app's Export menu, the read-only API
// and the MCP `export` tool build the same tables with the same function.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { RunBundleV1 } from "@saylent/engine/bundle";
import type { CrawlerReport } from "@saylent/engine/crawler-analytics";
import {
  EXPORT_FORMAT,
  EXPORT_TABLES,
  buildDataExport,
  isExportTable,
  tableCsv,
  type DataExport,
  type ExportTable,
} from "@saylent/report/data-export";
import { HELP_OPTION, opt, options } from "../help";
import { loadBundleFileAsync } from "../run";

const HELP = `saylent export <run.json|dir> [<run.json> ...] [options]

Export a run's data as CSV or JSON: ${EXPORT_TABLES.join(", ")}.
The columns are versioned (${EXPORT_FORMAT}) and documented at
https://yotambraun.github.io/saylent/docs/export. $0: reads files only.

A directory is read as one run (it holds run.json) or as a brand's history
(<dir>/<YYYY-MM-DD>/run.json); several runs export as one set of tables, one
row per run where it applies.

Options:
${options([
  opt("--format <csv|json>", "csv: one <table>.csv per table (default); json: export.json"),
  opt("--out <dir>", "Where to write (default ./saylent-export)"),
  opt("--table <name>", "Only this table"),
  opt("--crawlers <file>", "Add a crawlers.json from `saylent crawlers --out`"),
  opt("--stdout", "Print instead of writing files (CSV needs --table)"),
  HELP_OPTION,
])}`;

const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;

/** The run.json files a positional names: the file, <dir>/run.json, or every
 *  <dir>/<YYYY-MM-DD>/run.json (oldest first). */
export function bundlePathsFor(p: string): string[] {
  const abs = path.resolve(p);
  if (!existsSync(abs)) throw new Error(`${p}: no such file or directory.`);
  if (!statSync(abs).isDirectory()) return [abs];
  if (existsSync(path.join(abs, "run.json"))) return [path.join(abs, "run.json")];
  const dated = readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory() && DATE_DIR.test(e.name) && existsSync(path.join(abs, e.name, "run.json")))
    .map((e) => path.join(abs, e.name, "run.json"))
    .sort();
  if (dated.length === 0) throw new Error(`${p}: no run.json in it or in a <YYYY-MM-DD>/ folder under it.`);
  return dated;
}

/** A crawlers.json written by `saylent crawlers --out` (or --json). */
export function readCrawlerReport(file: string): CrawlerReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path.resolve(file), "utf8"));
  } catch (e) {
    throw new Error(`${file}: not readable JSON (${e instanceof Error ? e.message : String(e)}).`);
  }
  const r = parsed as Partial<CrawlerReport> | null;
  if (!r || r.schema_version !== 1 || !Array.isArray(r.bots) || !r.window) {
    throw new Error(`${file}: not a crawlers.json from \`saylent crawlers --out\` (schema_version 1).`);
  }
  return r as CrawlerReport;
}

/** Write the export; returns the paths written. */
export function writeExport(doc: DataExport, format: "csv" | "json", outDir: string, table: ExportTable | null): string[] {
  mkdirSync(outDir, { recursive: true });
  if (format === "json") {
    const file = path.join(outDir, table ? `${table}.json` : "export.json");
    const body = table ? { ...doc, columns: { [table]: doc.columns[table] }, tables: { [table]: doc.tables[table] } } : doc;
    writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
    return [file];
  }
  const written: string[] = [];
  for (const t of table ? [table] : EXPORT_TABLES) {
    const file = path.join(outDir, `${t}.csv`);
    writeFileSync(file, tableCsv(doc, t));
    written.push(file);
  }
  return written;
}

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        format: { type: "string", default: "csv" },
        out: { type: "string" },
        table: { type: "string" },
        crawlers: { type: "string" },
        stdout: { type: "boolean", default: false },
      },
    });
  } catch (e) {
    process.stderr.write(`\n  ${e instanceof Error ? e.message : String(e)}\n\n${HELP}\n`);
    return 1;
  }
  const { values, positionals } = parsed;
  if (positionals.length === 0 && !values.crawlers) {
    process.stderr.write(`Missing <run.json>.\n\n${HELP}\n`);
    return 1;
  }
  const format = values.format;
  if (format !== "csv" && format !== "json") {
    process.stderr.write(`\n  --format ${format}: expected csv or json.\n`);
    return 1;
  }
  const table = values.table ?? null;
  if (table !== null && !isExportTable(table)) {
    process.stderr.write(`\n  --table ${table}: expected one of ${EXPORT_TABLES.join(", ")}.\n`);
    return 1;
  }
  if (values.stdout && format === "csv" && !table) {
    process.stderr.write(`\n  CSV is one table per file: pass --table <name> with --stdout, or drop --stdout to write every table.\n`);
    return 1;
  }

  const bundles: RunBundleV1[] = [];
  let crawlers: CrawlerReport | null = null;
  try {
    for (const p of positionals) {
      for (const file of bundlePathsFor(p)) bundles.push(await loadBundleFileAsync(file));
    }
    if (values.crawlers) crawlers = readCrawlerReport(values.crawlers);
  } catch (e) {
    process.stderr.write(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  const doc = buildDataExport({ bundles, crawlers });
  if (values.stdout) {
    if (format === "json") {
      const body = table ? { ...doc, columns: { [table]: doc.columns[table] }, tables: { [table]: doc.tables[table] } } : doc;
      process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    } else {
      process.stdout.write(tableCsv(doc, table as ExportTable));
    }
    return 0;
  }
  const outDir = path.resolve(values.out ?? "saylent-export");
  const written = writeExport(doc, format, outDir, table);
  const counts = (table ? [table] : EXPORT_TABLES).map((t) => `${t} ${doc.tables[t].length}`).join(", ");
  process.stdout.write(`\n  Exported  ${bundles.length} run${bundles.length === 1 ? "" : "s"}${crawlers ? " + crawlers" : ""} (${EXPORT_FORMAT})\n`);
  process.stdout.write(`  Rows      ${counts}\n`);
  process.stdout.write(`  Wrote     ${written.length === 1 ? written[0] : `${written.length} files in ${outDir}`}\n`);
  return 0;
}
