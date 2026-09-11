"use server";
// Admin server actions. EVERY action runs requireAdmin() FIRST (never
// trusts the layout), then acts through the SERVICE-ROLE client (cross-user
// writes bypass RLS). The acting admin's id is passed explicitly to the DB
// (auth.uid() is NULL under service role — see 0020 header). All mutations leave
// an audit_log trail.
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { setRunsPaused } from "@/lib/app-settings";
import { testConfiguredProviders, type ProviderTestResult } from "@/lib/provider-check";
import { createRun, retryRun } from "@/lib/runs";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult = { ok: boolean; error?: string };

export async function setAccountDisabled(
  targetUserId: string,
  disabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireAdmin();
  const admin = createAdminClient();

  // The ban lives in GoTrue (auth.users), not a table we control, so it can't
  // share a SQL transaction with the audit_log insert the way the atomic RPCs
  // below do (e.g. admin_mark_run_failed). We get all-or-nothing another way:
  // apply the ban, then write the audit; if the audit write fails, COMPENSATE by
  // reverting the ban — so we never leave a state change without its audit trail
  // (the bug in the prior fire-and-forget code).
  const { error } = await admin.auth.admin.updateUserById(targetUserId, {
    ban_duration: disabled ? "876000h" : "none",
  });
  if (error) return { ok: false, error: error.message };

  const { error: auditError } = await admin.from("audit_log").insert({
    actor_id: actor.id,
    action: disabled ? "account.disable" : "account.enable",
    target_user_id: targetUserId,
    target_table: "auth.users",
    target_id: targetUserId,
    after: { banned: disabled },
    reason: disabled ? "admin disabled account" : "admin re-enabled account",
  });
  if (auditError) {
    // revert the ban so state + audit stay consistent
    await admin.auth.admin.updateUserById(targetUserId, {
      ban_duration: disabled ? "none" : "876000h",
    });
    return { ok: false, error: "Could not record the audit entry: no change applied." };
  }

  revalidatePath(`/admin/users/${targetUserId}`);
  return { ok: true };
}

// The global kill switch, operable now (the admin UI
// button lands with the ADMIN console). Toggles the runtime app_settings flag
// checked at the top of createRun; no redeploy needed. Audited like every other
// privileged action.
export async function pauseRuns(paused: boolean): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireAdmin();

  const { error } = await setRunsPaused(paused);
  if (error) return { ok: false, error };

  const admin = createAdminClient();
  await admin.from("audit_log").insert({
    actor_id: actor.id,
    action: paused ? "runs.pause" : "runs.resume",
    target_table: "app_settings",
    target_id: "global",
    after: { runs_paused: paused },
    reason: paused ? "kill switch engaged" : "kill switch released",
  });

  revalidatePath("/admin");
  return { ok: true };
}

// ── Cost-control: daily spend cap ───────────────────────────────────────────
// Sets (or clears, with null) the global daily spend ceiling. Atomic: the RPC
// writes app_settings AND the audit_log row in one transaction.
export async function setDailyCap(cap: number | null, reason: string): Promise<ActionResult> {
  const actor = await requireAdmin();
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "A reason is required." };
  if (cap != null && (!Number.isFinite(cap) || cap < 0)) {
    return { ok: false, error: "Cap must be zero or a positive number (or blank to clear)." };
  }
  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_set_daily_cap", {
    p_actor: actor.id,
    p_cap: cap,
    p_reason: trimmed,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

// ── Run controls (audited) ──────────────────────────────────────────────────
// re-run + retry dispatch to Inngest (external), so the audit is written after a
// successful dispatch (can't share a SQL txn with createRun's insert+emit). The
// run row itself is the durable record; the audit_log captures operator intent.
export async function adminReRun(
  targetUserId: string,
  brandId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string; runId?: string }> {
  const actor = await requireAdmin();
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "A reason is required." };
  const res = await createRun({ userId: targetUserId, brandId, kind: "audit" });
  if (!res.ok) return { ok: false, error: res.reason };
  const admin = createAdminClient();
  await admin.from("audit_log").insert({
    actor_id: actor.id,
    action: "run.rerun",
    target_user_id: targetUserId,
    target_table: "runs",
    target_id: res.runId,
    after: { brand_id: brandId, run_id: res.runId },
    reason: trimmed,
  });
  revalidatePath(`/admin/users/${targetUserId}`);
  return { ok: true, runId: res.runId };
}

export async function adminRetryRun(
  targetUserId: string,
  runId: string,
  reason: string,
): Promise<ActionResult> {
  const actor = await requireAdmin();
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "A reason is required." };
  const res = await retryRun(targetUserId, runId);
  if (!res.ok) return { ok: false, error: res.reason };
  const admin = createAdminClient();
  await admin.from("audit_log").insert({
    actor_id: actor.id,
    action: "run.retry",
    target_user_id: targetUserId,
    target_table: "runs",
    target_id: runId,
    after: { run_id: runId },
    reason: trimmed,
  });
  revalidatePath(`/admin/users/${targetUserId}`);
  return { ok: true };
}

// mark-failed = the manual watchdog for a hung run. Atomic (RPC: update + audit).
export async function adminMarkRunFailed(
  targetUserId: string,
  runId: string,
  reason: string,
): Promise<ActionResult> {
  const actor = await requireAdmin();
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "A reason is required." };
  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_mark_run_failed", {
    p_actor: actor.id,
    p_run_id: runId,
    p_reason: trimmed,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/users/${targetUserId}`);
  return { ok: true };
}

// ── Account recovery (magic-link) ───────────────────────────────────────────
// Admin-assisted recovery for a magic-link-only lockout. Generates a fresh
// magic link WITHOUT emailing it; the operator
// conveys it to the verified user out-of-band. Audited (non-atomic: generateLink
// is a GoTrue call). OPERATOR STEP: verify the requester's identity first, then
// copy the returned link and send it over a trusted channel — never post it
// publicly. The link is single-use and short-lived.
export async function adminRecoveryLink(
  targetUserId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string; link?: string }> {
  const actor = await requireAdmin();
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "A reason is required." };
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("email")
    .eq("id", targetUserId)
    .maybeSingle();
  if (!profile?.email) return { ok: false, error: "No email on file for this user." };

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: profile.email,
  });
  if (error) return { ok: false, error: error.message };

  await admin.from("audit_log").insert({
    actor_id: actor.id,
    action: "account.recovery_link",
    target_user_id: targetUserId,
    target_table: "auth.users",
    target_id: targetUserId,
    after: { generated: true },
    reason: trimmed,
  });
  return { ok: true, link: data.properties?.action_link };
}

// ── Trust & safety actions (all audited, atomic RPCs) ───────────────────────
export async function adminUnpublishShare(runId: string, reason: string): Promise<ActionResult> {
  const actor = await requireAdmin();
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "A reason is required." };
  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_unpublish_share", {
    p_actor: actor.id,
    p_run_id: runId,
    p_reason: trimmed,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/takedown");
  return { ok: true };
}

export async function adminDisableBrand(brandId: string, reason: string): Promise<ActionResult> {
  const actor = await requireAdmin();
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "A reason is required." };
  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_disable_brand", {
    p_actor: actor.id,
    p_brand_id: brandId,
    p_reason: trimmed,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/takedown");
  return { ok: true };
}

export async function adminBlockDomain(domain: string, reason: string): Promise<ActionResult> {
  const actor = await requireAdmin();
  const trimmed = reason.trim();
  const cleanDomain = domain.trim().toLowerCase();
  if (!cleanDomain) return { ok: false, error: "A domain is required." };
  if (!trimmed) return { ok: false, error: "A reason is required." };
  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_block_domain", {
    p_actor: actor.id,
    p_domain: cleanDomain,
    p_reason: trimmed,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/takedown");
  return { ok: true };
}

export async function adminResolveTakedown(
  id: string,
  status: "resolved" | "dismissed",
  reason: string,
): Promise<ActionResult> {
  const actor = await requireAdmin();
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "A reason is required." };
  if (!["resolved", "dismissed"].includes(status)) return { ok: false, error: "Invalid status." };
  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_resolve_takedown", {
    p_actor: actor.id,
    p_id: id,
    p_status: status,
    p_reason: trimmed,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/takedown");
  return { ok: true };
}

// ── Budget & limits: Providers card ─────────────────────────────────────────
// Runs the same free per-provider check as `saylent keys test` (the CLI, see
// packages/cli/src/key-test.ts) against whichever provider keys this deployment
// has configured. Never returns a key value — only presence + a one-word/HTTP-
// status detail, same as the CLI's own masking rule.
export async function testProviders(): Promise<{ ok: boolean; results: ProviderTestResult[] }> {
  await requireAdmin();
  const results = await testConfiguredProviders();
  return { ok: true, results };
}
