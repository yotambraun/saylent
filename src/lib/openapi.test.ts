import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXPORT_TABLES } from "@saylent/report/data-export";
import { buildOpenApi } from "./openapi";

describe("OpenAPI document", () => {
  it("matches the copy on the docs site", () => {
    // regenerate: npx tsx -e 'import { buildOpenApi } from "./src/lib/openapi.ts"; ...' (docs/guides/COMMANDS.md)
    const copy = readFileSync(path.resolve(process.cwd(), "website/public/openapi/saylent-api-v1.json"), "utf8");
    expect(JSON.parse(copy)).toEqual(JSON.parse(JSON.stringify(buildOpenApi())));
  });

  it("describes every route handler under /api/v1 and every export table", () => {
    const doc = buildOpenApi();
    expect(Object.keys(doc.paths).sort()).toEqual(["/api/v1/brands", "/api/v1/brands/{id}/export", "/api/v1/brands/{id}/runs", "/api/v1/openapi.json", "/api/v1/runs/{id}"]);
    expect(Object.keys(doc.components.schemas.Export.properties.tables.properties)).toEqual(EXPORT_TABLES);
    // read-only: GET only
    for (const p of Object.values(doc.paths)) expect(Object.keys(p)).toEqual(["get"]);
  });
});
