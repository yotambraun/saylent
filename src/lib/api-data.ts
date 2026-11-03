import "server-only";
// The reads behind the read-only API (/api/v1/*) and the app's Export menu.
// EVERY query on brands, runs and crawler_reports carries `.eq("user_id", userId)`: on the
// session path RLS already guarantees it (belt and braces, as the account
// export does); on the token path the client is the service role, and this
// filter is the guard. Child rows are read only through loadRunBundle, after
// the run passed the owner check. api-data.test.ts asserts the filter is on
// every brands/runs/crawler_reports query this module makes.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RunBundleV1 } from "@saylent/engine";
import type { CrawlerReport } from "@saylent/engine/crawler-analytics";
import { buildDataExport, type DataExport } from "@saylent/report/data-export";
import { fetchSourceOverrides } from "./dossier-data";
import { loadRunBundle } from "./run-bundle";

/** How many finished runs a brand history export reads. */
export const HISTORY_RUN_LIMIT = 24;

export interface ApiBrand {
  id: string;
  name: string;
  domain: string;
  created_at: string;
}

export async function listBrands(client: SupabaseClient, userId: string): Promise<ApiBrand[]> {
  const { data, error } = await client
    .from("brands")
    .select("id,name,domain,created_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error("brands read failed");
  return (data ?? []) as ApiBrand[];
}

export async function ownBrand(client: SupabaseClient, userId: string, brandId: string): Promise<ApiBrand | null> {
  const { data, error } = await client
    .from("brands")
    .select("id,name,domain,created_at")
    .eq("id", brandId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error("brand read failed");
  return (data ?? null) as ApiBrand | null;
}

export interface ApiRunRow {
  id: string;
  kind: string;
  profile: string;
  created_at: string;
  finished_at: string | null;
  answered: number | null;
  recommended: number | null;
  mentioned: number | null;
  est_cost_usd: number | null;
}

/** A brand's finished, visible runs, newest first. */
export async function listBrandRuns(client: SupabaseClient, userId: string, brandId: string, limit = 100): Promise<ApiRunRow[]> {
  const { data, error } = await client
    .from("runs")
    .select("id,kind,profile,created_at,finished_at,scores,est_cost_usd")
    .eq("brand_id", brandId)
    .eq("user_id", userId)
    .eq("status", "done")
    .is("hidden_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("runs read failed");
  return (data ?? []).map((r) => {
    const o = (r.scores as { overall?: { answered?: number; recommended?: number; mentioned?: number } } | null)?.overall;
    return {
      id: r.id as string,
      kind: r.kind as string,
      profile: r.profile as string,
      created_at: r.created_at as string,
      finished_at: (r.finished_at as string | null) ?? null,
      answered: o?.answered ?? null,
      recommended: o?.recommended ?? null,
      mentioned: o?.mentioned ?? null,
      est_cost_usd: (r.est_cost_usd as number | null) ?? null,
    };
  });
}

export type ExportResult =
  | { ok: true; doc: DataExport; bundles: RunBundleV1[]; brandName: string }
  | { ok: false; status: 404 | 409; error: string };

/** One run as the saylent.export/v1 document, with the brand's source-type
 *  corrections applied the way the report applies them. */
export async function runExport(client: SupabaseClient, userId: string, runId: string): Promise<ExportResult & { bundle?: RunBundleV1 }> {
  const r = await loadRunBundle(client, runId, { ownerId: userId });
  if (!r.ok) return r;
  const overrides = await fetchSourceOverrides(client, r.brandId);
  return { ok: true, doc: buildDataExport({ bundles: [r.bundle], overrides }), bundles: [r.bundle], bundle: r.bundle, brandName: r.brandName };
}

/** The brand's latest uploaded AI-crawler report (migration 0046), if any. */
export async function latestCrawlerReport(client: SupabaseClient, userId: string, brandId: string): Promise<CrawlerReport | null> {
  const { data, error } = await client
    .from("crawler_reports")
    .select("report")
    .eq("brand_id", brandId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const r = (data as { report?: Partial<CrawlerReport> }).report;
  return r && r.schema_version === 1 && Array.isArray(r.bots) && r.window ? (r as CrawlerReport) : null;
}

/** A brand's last HISTORY_RUN_LIMIT finished runs as one export, with its
 *  latest crawler report as the crawlers table. */
export async function brandExport(client: SupabaseClient, userId: string, brandId: string): Promise<ExportResult> {
  const brand = await ownBrand(client, userId, brandId);
  if (!brand) return { ok: false, status: 404, error: "brand not found" };
  const runs = await listBrandRuns(client, userId, brandId, HISTORY_RUN_LIMIT);
  const bundles: RunBundleV1[] = [];
  for (const run of runs) {
    const r = await loadRunBundle(client, run.id, { ownerId: userId });
    if (r.ok) bundles.push(r.bundle);
  }
  const [overrides, crawlers] = await Promise.all([fetchSourceOverrides(client, brandId), latestCrawlerReport(client, userId, brandId)]);
  return { ok: true, doc: buildDataExport({ bundles, overrides, crawlers }), bundles, brandName: brand.name };
}
