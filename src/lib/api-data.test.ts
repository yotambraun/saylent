// The token path reads with the service client, so the owner filter in
// api-data.ts is the guard: every brands and runs query must carry
// .eq("user_id", <caller>). This records every query the module makes.
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("./run-bundle", () => ({ loadRunBundle: async () => ({ ok: false, status: 404, error: "run not found" }) }));
vi.mock("./dossier-data", () => ({ fetchSourceOverrides: async () => null }));

import { brandExport, listBrandRuns, listBrands, ownBrand, runExport } from "./api-data";

type Q = { table: string; filters: [string, unknown][] };

function recorder(rows: Record<string, unknown>) {
  const queries: Q[] = [];
  const client = {
    from(table: string) {
      const q: Q = { table, filters: [] };
      queries.push(q);
      const b = {
        select: () => b,
        order: () => b,
        limit: () => b,
        is: (c: string, v: unknown) => (q.filters.push([c, v]), b),
        eq: (c: string, v: unknown) => (q.filters.push([c, v]), b),
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: (rows[`${table}[]`] as unknown[]) ?? [], error: null }),
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}

const owned = (queries: Q[], user: string) => queries.every((q) => !["brands", "runs", "crawler_reports"].includes(q.table) || q.filters.some(([c, v]) => c === "user_id" && v === user));

describe("api-data owner scoping", () => {
  it("filters every brands and runs query by the caller", async () => {
    const { client, queries } = recorder({ brands: { id: "b1", name: "Acme", domain: "acme.example", created_at: "x" }, "runs[]": [{ id: "r1", scores: null }] });
    await listBrands(client, "u1");
    await ownBrand(client, "u1", "b1");
    await listBrandRuns(client, "u1", "b1");
    await brandExport(client, "u1", "b1");
    await runExport(client, "u1", "r1");
    expect(queries.length).toBeGreaterThan(3);
    expect(owned(queries, "u1")).toBe(true);
  });

  it("lists only finished, visible runs", async () => {
    const { client, queries } = recorder({});
    await listBrandRuns(client, "u1", "b1");
    expect(queries[0].filters).toEqual(expect.arrayContaining([["status", "done"], ["hidden_at", null], ["brand_id", "b1"]]));
  });

  it("a brand that is not yours is a 404, read no further", async () => {
    const { client, queries } = recorder({});
    expect(await brandExport(client, "u1", "someone-elses")).toEqual({ ok: false, status: 404, error: "brand not found" });
    expect(queries).toHaveLength(1);
  });
});
