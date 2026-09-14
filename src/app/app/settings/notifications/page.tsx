// Settings › Notifications — email_reports toggle (auto-saves). Read uses the
// USER's session client (RLS = own row).
//
// The "Email reports" copy names the emails that ACTUALLY send. Two templates
// exist and are never called (`welcome`, `movement` in src/emails/templates.ts),
// and the old copy promised one of them ("Report-ready and movement emails
// arrive at public launch") — a promise nothing in src/inngest/functions.ts
// keeps. The only two sends are the report-ready email at the end of an audit
// and the day-10 verify reminder. emailConfigured() (src/lib/email.ts) is the
// same three-condition check sendEmail itself makes, so the row can say plainly
// when this deployment cannot send at all instead of implying it will.
import { emailConfigured } from "@/lib/email";
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
        description={
          emailConfigured()
            ? "Two emails: your report when an audit finishes, and one reminder to re-measure ten days later. Turning this off stops both."
            : "Two emails would send: your report when an audit finishes, and one reminder to re-measure ten days later. This deployment has no email configured, so neither sends today."
        }
      >
        <EmailReportsToggle initial={profile?.email_reports ?? true} />
      </SettingRow>
    </SettingsSection>
  );
}
