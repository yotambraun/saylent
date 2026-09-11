"use server";
// Unified settings — personal-surface server actions (moved from /app/account in
// the settings consolidation; behavior unchanged). All writes go through the
// USER's session client (RLS: own row only). display_name and email_reports are
// the only self-writable profile columns (0016 + 0019 grants); plan, credits and
// role are NEVER written here.
import { revalidatePath } from "next/cache";
import { assertNotDemo } from "@/lib/demo-mode";
import { createClient } from "@/lib/supabase/server";
import { displayNameSchema, isValidTimeZone } from "@saylent/report/validation";

export async function updateDisplayName(
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  // Hosted read-only demo — refuse every write.
  const demo = assertNotDemo();
  if (demo) return demo;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // zod bound — display_name flows into greetings/UI.
  const parsed = displayNameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const trimmed = parsed.data;
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: trimmed || null })
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/settings/profile");
  return { ok: true };
}

// Self-set IANA time zone. Written on
// the USER's RLS client to profiles.timezone (0027 column grant). Empty clears it
// (→ UTC fallback). Scheduled crons will read this column for email/verify
// send-time; nothing schedule-related is built here.
export async function updateTimezone(
  tz: string,
): Promise<{ ok: boolean; error?: string }> {
  // Hosted read-only demo — refuse every write.
  const demo = assertNotDemo();
  if (demo) return demo;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const trimmed = tz.trim();
  if (trimmed && !isValidTimeZone(trimmed)) {
    return { ok: false, error: "Pick a valid time zone." };
  }
  const { error } = await supabase
    .from("profiles")
    .update({ timezone: trimmed || null })
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/settings/profile");
  return { ok: true };
}

export async function toggleEmailReports(enabled: boolean): Promise<{ ok: boolean }> {
  // Hosted read-only demo — refuse every write.
  const demo = assertNotDemo();
  if (demo) return demo;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const { error } = await supabase
    .from("profiles")
    .update({ email_reports: enabled })
    .eq("id", user.id);
  revalidatePath("/app/settings/notifications");
  return { ok: !error };
}
