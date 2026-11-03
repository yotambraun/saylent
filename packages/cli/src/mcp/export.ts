// The MCP `export` tool ($0): the documented export tables
// (@saylent/report/data-export, the same ones `saylent export` writes) for an
// agent. Without out_dir it returns one table's rows inline (capped); with
// out_dir it writes the files inside the server's working directory and
// returns their paths.
import type { RunBundleV1 } from "@saylent/engine/bundle";
import { EXPORT_COLUMNS, EXPORT_FORMAT, EXPORT_TABLES, buildDataExport, tableCsv, type ExportTable } from "@saylent/report/data-export";
import { bundlePathsFor, readCrawlerReport, writeExport } from "../commands/export";
import { resolveInside } from "./crawlers";
import { resolveMcpOutDir } from "./tools";

export interface ExportToolArgs {
  bundle_paths: string[];
  crawlers_path?: string;
  table?: ExportTable;
  format?: "json" | "csv";
  out_dir?: string;
  limit?: number;
}

export async function exportTool(
  args: ExportToolArgs,
  deps: { loadBundle: (file: string) => Promise<RunBundleV1>; cwd?: string },
): Promise<Record<string, unknown>> {
  const cwd = deps.cwd ?? process.cwd();
  const bundles: RunBundleV1[] = [];
  for (const p of args.bundle_paths) for (const f of bundlePathsFor(p)) bundles.push(await deps.loadBundle(f));
  const crawlers = args.crawlers_path ? readCrawlerReport(resolveInside(args.crawlers_path, cwd, "crawlers_path")) : null;
  const doc = buildDataExport({ bundles, crawlers });
  const format = args.format ?? "json";
  const counts = Object.fromEntries(EXPORT_TABLES.map((t) => [t, doc.tables[t].length]));
  if (args.out_dir) {
    const dir = resolveMcpOutDir(cwd, args.out_dir, args.out_dir);
    const written = writeExport(doc, format, dir, args.table ?? null);
    return { export_format: EXPORT_FORMAT, written, rows: counts, notes: doc.notes, cost_usd: 0 };
  }
  const table: ExportTable = args.table ?? "runs";
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 1000);
  const rows = doc.tables[table];
  return {
    export_format: EXPORT_FORMAT,
    table,
    columns: EXPORT_COLUMNS[table],
    rows: format === "csv" ? undefined : rows.slice(0, limit),
    csv: format === "csv" ? tableCsv({ tables: { ...doc.tables, [table]: rows.slice(0, limit) } }, table) : undefined,
    total_rows: rows.length,
    truncated: rows.length > limit,
    row_counts: counts,
    notes: doc.notes,
    cost_usd: 0,
  };
}
