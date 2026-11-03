import "server-only";
// Response shapes shared by the /api/v1 routes and the app's Export menu
// (which links to the same routes, so a download in the browser and a curl
// with a token return the same bytes).
import { writeBundle, type RunBundleV1 } from "@saylent/engine";
import { EXPORT_TABLES, isExportTable, tableCsv, type DataExport } from "@saylent/report/data-export";
import { slugifyBrand } from "@saylent/report/run-export";
import { apiError } from "./api-auth";

const NO_STORE = { "Cache-Control": "no-store" };

export function apiJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE },
  });
}

/** `?format=json|csv|bundle&table=<name>&download=1` over one export. */
export function exportResponse(
  doc: DataExport,
  params: URLSearchParams,
  opts: { brandName: string; bundle?: RunBundleV1 | null; scope: "run" | "history" },
): Response {
  const format = params.get("format") ?? "json";
  const table = params.get("table");
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `saylent-${slugifyBrand(opts.brandName)}-${opts.scope === "history" ? "history-" : ""}${stamp}`;
  const attach = params.get("download") === "1";
  const disposition = (name: string): Record<string, string> => (attach ? { "Content-Disposition": `attachment; filename="${name}"` } : {});
  if (table !== null && !isExportTable(table)) return apiError(400, `Unknown table "${table}". Tables: ${EXPORT_TABLES.join(", ")}.`);
  if (format === "bundle") {
    if (!opts.bundle) return apiError(400, "format=bundle is for one run: /api/v1/runs/{id}?format=bundle.");
    return new Response(writeBundle(opts.bundle), {
      headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE, ...disposition(`${base}.run.json`) },
    });
  }
  if (format === "csv") {
    if (!table) return apiError(400, `format=csv needs table=<name>, one of ${EXPORT_TABLES.join(", ")}.`);
    return new Response(tableCsv(doc, table), {
      headers: { "Content-Type": "text/csv; charset=utf-8", ...NO_STORE, ...disposition(`${base}-${table}.csv`) },
    });
  }
  if (format !== "json") return apiError(400, `Unknown format "${format}". Formats: json, csv${opts.bundle ? ", bundle" : ""}.`);
  const body = table ? { ...doc, columns: { [table]: doc.columns[table] }, tables: { [table]: doc.tables[table] } } : doc;
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE, ...disposition(`${base}${table ? `-${table}` : ""}.json`) },
  });
}
