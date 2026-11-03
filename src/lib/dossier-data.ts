import "server-only";
// One dossier data-assembly for BOTH the owner page (RLS client) and the public
// share page (service-role client gated by share_token). Extracted 2026-07-07
// from app/run/[id]/page.tsx; mirrors the getDemoRun precedent.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SourceOverrides } from "@saylent/engine/sources";
import { readSourceOverrides } from "./source-history";

/** the whole dossier in ONE round trip via get_dossier (migration 0014);
 * RLS applies (SECURITY INVOKER) — returns null when unseen/missing */
export async function fetchDossierViaRpc(client: SupabaseClient, runId: string) {
  const { data, error } = await client.rpc("get_dossier", { p_run_id: runId });
  if (error || !data || !data.run) return null;
  return data as {
    run: Record<string, unknown> & {
      id: string;
      kind: string;
      status: string;
      created_at: string;
      finished_at: string | null;
      share_token: string | null;
      scores: unknown;
    };
    brand: {
      name: string;
      domain: string;
      aliases: string[];
      competitors: string[];
      authorized_at: string | null;
    } | null;
    answers: unknown[];
    corpus: unknown[];
    checks: unknown[];
    fixes: unknown[];
    previous: { created_at: string; finished_at: string | null; scores: unknown } | null;
  };
}

/** The brand's "Source types" corrections (brands.run_options.sourceOverrides)
 *  for the report's Sources & opportunities section. get_dossier does not carry
 *  run_options, so this is one narrow read of that single field; the caller's
 *  client decides the access (RLS session for the owner, service role for the
 *  token-gated share page and the admin view-as). Null on any miss: the section
 *  then classifies with the built-in rules alone. */
export async function fetchSourceOverrides(
  client: SupabaseClient,
  brandId: string | null | undefined,
): Promise<SourceOverrides | null> {
  if (!brandId) return null;
  const { data, error } = await client.from("brands").select("run_options").eq("id", brandId).maybeSingle();
  if (error || !data) return null;
  return readSourceOverrides((data as { run_options?: unknown }).run_options);
}

/** share-page fetch: service-role client + exact token; done audits only */
export async function getSharedRun(admin: SupabaseClient, token: string) {
  const { data: hit } = await admin
    .from("runs")
    .select("id")
    .eq("share_token", token)
    .eq("status", "done")
    .eq("kind", "audit")
    .maybeSingle();
  if (!hit) return null;
  const d = await fetchDossierViaRpc(admin, hit.id);
  if (!d || !d.brand) return null;
  return d;
}
