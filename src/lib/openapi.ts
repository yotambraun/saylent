// The read-only API (/api/v1/*) as an OpenAPI 3.1 document. Served at
// /api/v1/openapi.json and copied to the docs site
// (website/public/openapi/saylent-api-v1.json); openapi.test.ts fails when the
// copy drifts. Row schemas come from EXPORT_COLUMNS, so the spec cannot
// describe a column the export does not write.
import { EXPORT_COLUMNS, EXPORT_FORMAT, EXPORT_TABLES } from "@saylent/report/data-export";

const errorRef = { $ref: "#/components/responses/Error" };
const tableParam = {
  name: "table",
  in: "query",
  required: false,
  description: "One table. Required with format=csv.",
  schema: { type: "string", enum: EXPORT_TABLES },
};
const idParam = (what: string) => ({ name: "id", in: "path", required: true, description: `The ${what} id`, schema: { type: "string", format: "uuid" } });
const downloadParam = { name: "download", in: "query", required: false, description: "1 adds Content-Disposition: attachment", schema: { type: "string", enum: ["1"] } };

export function buildOpenApi() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Saylent read-only API",
      version: "1",
      description:
        "Read your own brands, runs and the saylent.export/v1 tables from a self-hosted Saylent app. Read-only: nothing here starts a run, spends credits or changes data. 60 requests a minute per user. Docs: https://yotambraun.github.io/saylent/docs/export#read-only-api",
      license: { name: "Apache-2.0", identifier: "Apache-2.0" },
    },
    servers: [{ url: "/", description: "Your own deployment" }],
    security: [{ token: [] }, { session: [] }],
    paths: {
      "/api/v1/brands": {
        get: {
          summary: "Your brands",
          responses: {
            "200": { description: "Brands", content: { "application/json": { schema: { type: "object", properties: { brands: { type: "array", items: { $ref: "#/components/schemas/Brand" } } } } } } },
            "401": errorRef,
            "429": errorRef,
            "503": errorRef,
          },
        },
      },
      "/api/v1/brands/{id}/runs": {
        get: {
          summary: "A brand's finished runs, newest first",
          parameters: [idParam("brand")],
          responses: {
            "200": {
              description: "The brand and its runs",
              content: { "application/json": { schema: { type: "object", properties: { brand: { $ref: "#/components/schemas/Brand" }, runs: { type: "array", items: { $ref: "#/components/schemas/RunSummary" } } } } } },
            },
            "401": errorRef,
            "404": errorRef,
            "429": errorRef,
            "503": errorRef,
          },
        },
      },
      "/api/v1/brands/{id}/export": {
        get: {
          summary: "The brand's last 24 finished runs as one export",
          parameters: [idParam("brand"), { name: "format", in: "query", required: false, schema: { type: "string", enum: ["json", "csv"], default: "json" } }, tableParam, downloadParam],
          responses: {
            "200": {
              description: "The export document, or one table as CSV",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Export" } }, "text/csv": { schema: { type: "string" } } },
            },
            "400": errorRef,
            "401": errorRef,
            "404": errorRef,
            "429": errorRef,
            "503": errorRef,
          },
        },
      },
      "/api/v1/runs/{id}": {
        get: {
          summary: "One finished run",
          parameters: [idParam("run"), { name: "format", in: "query", required: false, schema: { type: "string", enum: ["json", "csv", "bundle"], default: "json" } }, tableParam, downloadParam],
          responses: {
            "200": {
              description: "The export document, one table as CSV, or the lossless run bundle (run.json) with format=bundle",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Export" } }, "text/csv": { schema: { type: "string" } } },
            },
            "400": errorRef,
            "401": errorRef,
            "404": errorRef,
            "409": errorRef,
            "429": errorRef,
            "503": errorRef,
          },
        },
      },
      "/api/v1/openapi.json": {
        get: { summary: "This document", security: [], responses: { "200": { description: "OpenAPI 3.1", content: { "application/json": {} } } } },
      },
    },
    components: {
      securitySchemes: {
        token: { type: "http", scheme: "bearer", description: "A personal API token (slt_...) from Settings › API tokens" },
        session: { type: "apiKey", in: "cookie", name: "sb-<project-ref>-auth-token", description: "A signed-in app session (the app's own Export links)" },
      },
      responses: {
        Error: {
          description: "An error",
          headers: { "Retry-After": { description: "Seconds to wait, on 429", schema: { type: "integer" } } },
          content: { "application/json": { schema: { type: "object", required: ["error"], properties: { error: { type: "string" } } } } },
        },
      },
      schemas: {
        Brand: {
          type: "object",
          properties: { id: { type: "string", format: "uuid" }, name: { type: "string" }, domain: { type: "string" }, created_at: { type: "string", format: "date-time" } },
        },
        RunSummary: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            kind: { type: "string", enum: ["audit", "verify"] },
            profile: { type: "string" },
            created_at: { type: "string", format: "date-time" },
            finished_at: { type: ["string", "null"], format: "date-time" },
            answered: { type: ["integer", "null"] },
            recommended: { type: ["integer", "null"] },
            mentioned: { type: ["integer", "null"] },
            est_cost_usd: { type: ["number", "null"] },
          },
        },
        Export: {
          type: "object",
          required: ["export_format", "schema_version", "generated_at", "columns", "tables"],
          properties: {
            export_format: { const: EXPORT_FORMAT },
            schema_version: { type: "integer" },
            generated_at: { type: "string", format: "date-time" },
            columns: { type: "object", additionalProperties: { type: "array", items: { type: "string" } } },
            tables: {
              type: "object",
              properties: Object.fromEntries(
                EXPORT_TABLES.map((t) => [
                  t,
                  {
                    type: "array",
                    items: {
                      type: "object",
                      properties: Object.fromEntries(EXPORT_COLUMNS[t].map((c) => [c, {}])),
                      description: `Columns in order: ${EXPORT_COLUMNS[t].join(", ")}. See the docs for each column's meaning.`,
                    },
                  },
                ]),
              ),
            },
            notes: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  };
}
