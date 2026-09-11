"use server";
// Admin support-queue action, kept in its own file rather than the shared
// admin/actions.ts. requireAdmin() runs FIRST, then the audited RPC (admin_resolve_support:
// status + audit_log in one transaction, migration 0028). The acting admin is
// passed explicitly (auth.uid() is NULL under the service role — see 0020 header).
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function resolveSupport(id: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireAdmin();
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "A reason is required." };
  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_resolve_support", {
    p_actor: actor.id,
    p_id: id,
    p_reason: trimmed,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/support");
  return { ok: true };
}
