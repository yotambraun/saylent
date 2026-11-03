"use server";
// Personal API tokens for the read-only API (migration 0048). The session is
// checked on the user's own client; the write then goes through the service
// client, because api_tokens grants the browser no write at all and never
// shows it token_hash. The token itself is returned once, to the creator, and
// is never stored or logged: only its SHA-256 hash is.
import { revalidatePath } from "next/cache";
import { newApiToken } from "@/lib/api-auth";
import { assertNotDemo } from "@/lib/demo-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Active (unrevoked) tokens one user may hold. */
const MAX_ACTIVE_TOKENS = 10;

export type CreateTokenResult = { ok: true; token: string; prefix: string } | { ok: false; error: string };
export type RevokeTokenResult = { ok: true } | { ok: false; error: string };

async function sessionUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function createApiToken(rawName: string): Promise<CreateTokenResult> {
  const demo = assertNotDemo();
  if (demo) return { ok: false, error: demo.error };
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "Sign in again." };
  const name = rawName.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 60) return { ok: false, error: "Name it, in 60 characters or fewer, so you can tell your tokens apart." };

  const admin = createAdminClient();
  const { count, error: countError } = await admin
    .from("api_tokens")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (countError) return { ok: false, error: "API tokens are not set up on this deployment yet: the operator applies migration 0048_api_tokens.sql." };
  if ((count ?? 0) >= MAX_ACTIVE_TOKENS) return { ok: false, error: `You have ${MAX_ACTIVE_TOKENS} active tokens. Revoke one first.` };

  const { token, hash, prefix } = newApiToken();
  const { error } = await admin.from("api_tokens").insert({ user_id: userId, name, token_hash: hash, prefix });
  if (error) return { ok: false, error: "The token could not be saved. Try again." };
  revalidatePath("/app/settings/api");
  return { ok: true, token, prefix };
}

export async function revokeApiToken(id: string): Promise<RevokeTokenResult> {
  const demo = assertNotDemo();
  if (demo) return { ok: false, error: demo.error };
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "Sign in again." };
  const { data, error } = await createAdminClient()
    .from("api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Token not found, or already revoked." };
  revalidatePath("/app/settings/api");
  return { ok: true };
}
