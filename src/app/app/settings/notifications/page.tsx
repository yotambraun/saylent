// Settings › Notifications — email_reports toggle (auto-saves). Read uses the
// USER's session client (RLS = own row).
import { createClient } from "@/lib/supabase/server";
import { SettingRow, SettingsSection } from "../setting-row";
import { BrowserNotificationsRow, EmailReportsToggle } from "./notifications-client";

export const metadata = { title: "Notifications · Saylent" };

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("email_reports")
    .eq("id", user!.id)
    .single();

  return (
    <SettingsSection title="Notifications" description="What Saylent emails you.">
      <SettingRow
        label="Browser notifications"
        description="A desktop ping the moment a report is ready, only while Saylent is open in a tab. Asked and stored by your browser, never by us."
      >
        <BrowserNotificationsRow />
      </SettingRow>
      <SettingRow
        label="Email reports"
        description="Report-ready and movement emails arrive at public launch. Receipts always included."
      >
        <EmailReportsToggle initial={profile?.email_reports ?? true} />
      </SettingRow>
    </SettingsSection>
  );
}
