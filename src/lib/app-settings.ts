// Global runtime kill switch + spend cap. Single-row
// app_settings (id=true, migration 0024). Service-role ONLY: RLS grants
// authenticated/anon no access, so every read/write here goes through the admin
// client. Toggled at runtime with no redeploy (admin action `pauseRuns` or the
// auto-trip when the daily spend ceiling is crossed).
// server-only build guard: keeps this service-role
// module out of any client bundle. Resolves to Next's real alias in app builds and to
// the scripts-scoped no-op stub under the tsx dev rig.
import "server-only";
import { createAdminClient } from "./supabase/admin";
import { DAILY_SPEND_CAP_USD } from "./limits";

export type AppSettings = { runsPaused: boolean; dailySpendCapUsd: number };

/** Read the single settings row through the service client. Missing row →
 *  safe defaults (not paused, env/const cap). */
export async function getAppSettings(): Promise<AppSettings> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("app_settings")
    .select("runs_paused,daily_spend_cap_usd")
    .eq("id", true)
    .maybeSingle();
  const cap = data?.daily_spend_cap_usd;
  return {
    runsPaused: data?.runs_paused ?? false,
    dailySpendCapUsd: cap != null ? Number(cap) : DAILY_SPEND_CAP_USD,
  };
}

/** The single writer for the kill switch. Used by the admin action (with an
 *  audit_log entry) and the spend-ceiling auto-trip (no actor). Never throws;
 *  returns the error message for the caller to surface if it wants to. */
export async function setRunsPaused(paused: boolean): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("app_settings")
    .upsert({ id: true, runs_paused: paused, updated_at: new Date().toISOString() });
  return { error: error?.message ?? null };
}
