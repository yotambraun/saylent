// Settings › Profile — display name (inline save), email (Secure Email Change),
// sign out. Reads use the USER's session client (RLS = own row).
import { authMethods } from "@/lib/auth-methods";
import { createClient } from "@/lib/supabase/server";
import { SettingsSection } from "../setting-row";
import { DisplayNameField, EmailField, SignOutRow, TimezoneField } from "./profile-client";

export const metadata = { title: "Profile · Saylent" };

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const uid = user!.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select("email,display_name,timezone")
    .eq("id", uid)
    .single();

  const email = profile?.email ?? user?.email ?? "";
  // Supabase exposes user.new_email while a Secure Email Change is pending.
  const pendingEmail = (user as { new_email?: string | null })?.new_email ?? null;

  return (
    <SettingsSection title="Profile" description="How you appear and sign in.">
      <DisplayNameField initialName={profile?.display_name ?? ""} />
      <TimezoneField initialTimezone={profile?.timezone ?? ""} />
      {/* Same false "no password" claim caught on Settings ›
          Account — this row makes it too, so it derives from the deployment's
          own auth config the same way. */}
      <EmailField
        email={email}
        pendingEmail={pendingEmail}
        hasPassword={authMethods().includes("password")}
      />
      <SignOutRow />
    </SettingsSection>
  );
}
