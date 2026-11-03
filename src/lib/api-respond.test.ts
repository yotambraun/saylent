import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBundle } from "@saylent/engine/bundle";
import { buildDataExport } from "@saylent/report/data-export";
import { exportResponse } from "./api-respond";

const bundle = readBundle(JSON.parse(readFileSync(path.resolve(process.cwd(), "examples/kestrel/run.json"), "utf8")));
const doc = buildDataExport({ bundles: [bundle] });
const q = (s: string) => new URLSearchParams(s);

describe("exportResponse", () => {
  it("returns the JSON document, one table, or one table as CSV, never cached", async () => {
    const all = exportResponse(doc, q(""), { brandName: "Kestrel Uptime", bundle, scope: "run" });
    expect(all.headers.get("cache-control")).toBe("no-store");
    expect((await all.json()).export_format).toBe("saylent.export/v1");
    const one = await exportResponse(doc, q("table=fixes"), { brandName: "K", scope: "run" }).json();
    expect(Object.keys(one.tables)).toEqual(["fixes"]);
    const csv = exportResponse(doc, q("format=csv&table=answers&download=1"), { brandName: "Kestrel Uptime", scope: "run" });
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.headers.get("content-disposition")).toMatch(/saylent-kestrel-uptime-\d{4}-\d{2}-\d{2}-answers\.csv/);
  });

  it("serves the bundle for one run only, and 400s on a bad format or table", async () => {
    expect(exportResponse(doc, q("format=bundle"), { brandName: "K", bundle, scope: "run" }).status).toBe(200);
    expect(exportResponse(doc, q("format=bundle"), { brandName: "K", scope: "history" }).status).toBe(400);
    expect(exportResponse(doc, q("format=csv"), { brandName: "K", scope: "run" }).status).toBe(400);
    expect(exportResponse(doc, q("format=xml"), { brandName: "K", scope: "run" }).status).toBe(400);
    expect(exportResponse(doc, q("table=users"), { brandName: "K", scope: "run" }).status).toBe(400);
  });
});
