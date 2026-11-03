"use server";
// Alerts & digest settings for one brand (migration 0047). Ownership is checked
// on the OWNER'S RLS client (a foreign brand id reads as missing); the write
// then goes through the service client, because brand_alerts grants the browser
// no write at all and its sealed columns are never readable from the browser.
// A webhook URL or secret left blank keeps the stored one; "remove" clears it.
// A URL is refused when it points at, or resolves to, a private, loopback or
// link-local address (src/lib/alert-targets.ts); delivery checks again.
import { revalidatePath } from "next/cache";
import { alertsAllowLoopback, validateAlertTargets } from "@/lib/alert-targets";
import { sendTestAlert, type AlertSettingsRow } from "@/lib/alerts";
import { assertNotDemo } from "@/lib/demo-mode";
import { seal, sealingAvailable } from "@/lib/secret-box";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface AlertSettingsForm {
  brandId: string;
  onRun: boolean;
  weeklyDigest: boolean;
  email: boolean;
  slackUrl: string;
  removeSlack: boolean;
  webhookUrl: string;
  webhookSecret: string;
  removeWebhook: boolean;
}

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

async function ownedBrand(brandId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: brand } = await supabase.from("brands").select("id,name,domain").eq("id", brandId).is("deleted_at", null).maybeSingle();
  return brand ? { user, brand: brand as { id: string; name: string; domain: string } } : null;
}

export async function saveAlertSettings(form: AlertSettingsForm): Promise<ActionResult> {
  const demo = assertNotDemo();
  if (demo) return { ok: false, error: demo.error };
  const owned = await ownedBrand(form.brandId);
  if (!owned) return { ok: false, error: "Brand not found." };

  const slack = form.slackUrl.trim();
  const hook = form.webhookUrl.trim();
  const secret = form.webhookSecret.trim();
  const badUrl = await validateAlertTargets({ slackUrl: slack, webhookUrl: hook }, { allowLoopback: alertsAllowLoopback() });
  if (badUrl) return { ok: false, error: badUrl };
  if (secret && secret.length < 16) return { ok: false, error: "Use a webhook secret of 16 characters or more." };
  if ((slack || hook || secret) && !sealingAvailable()) {
    return { ok: false, error: "This deployment has no APP_SECRET (16+ characters), so webhook URLs cannot be stored safely. Email alerts still work." };
  }

  const admin = createAdminClient();
  const { data: current } = await admin.from("brand_alerts").select("*").eq("brand_id", form.brandId).maybeSingle();
  const row: Partial<AlertSettingsRow> & { brand_id: string; user_id: string; updated_at: string } = {
    brand_id: form.brandId,
    user_id: owned.user.id,
    on_run: !!form.onRun,
    weekly_digest: !!form.weeklyDigest,
    email: !!form.email,
    slack_url_sealed: form.removeSlack ? null : slack ? seal(slack) : ((current as AlertSettingsRow | null)?.slack_url_sealed ?? null),
    webhook_url_sealed: form.removeWebhook ? null : hook ? seal(hook) : ((current as AlertSettingsRow | null)?.webhook_url_sealed ?? null),
    webhook_secret_sealed: form.removeWebhook ? null : secret ? seal(secret) : ((current as AlertSettingsRow | null)?.webhook_secret_sealed ?? null),
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("brand_alerts").upsert(row, { onConflict: "brand_id" });
  if (error) return { ok: false, error: "Could not save the alert settings. Has migration 0047 been applied?" };
  revalidatePath(`/app/brand/${form.brandId}/alerts`);
  return { ok: true, message: "Saved." };
}

export async function sendTestAlertAction(brandId: string): Promise<ActionResult> {
  const demo = assertNotDemo();
  if (demo) return { ok: false, error: demo.error };
  const owned = await ownedBrand(brandId);
  if (!owned) return { ok: false, error: "Brand not found." };
  const admin = createAdminClient();
  const { data: settings } = await admin.from("brand_alerts").select("*").eq("brand_id", brandId).maybeSingle();
  if (!settings) return { ok: false, error: "Save the settings first." };
  const results = await sendTestAlert(admin, settings as AlertSettingsRow, owned.brand);
  if (results.length === 0) return { ok: false, error: "No channel is on: tick email, or add a Slack or webhook URL." };
  const lines = results.map((r) => `${r.channel}: ${r.ok ? "sent" : r.error ?? r.status}`);
  return results.every((r) => r.ok) ? { ok: true, message: lines.join(" · ") } : { ok: false, error: lines.join(" · ") };
}
