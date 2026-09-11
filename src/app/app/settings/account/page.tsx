// Settings › Account — the destructive stuff, on its own screen (not a red card
// hanging off another section). Delete is permanent + type-to-confirm.
import Link from "next/link";
import { buttonVariants } from "@saylent/report/ui/button";
import { authMethods, signInRecoveryCopy } from "@/lib/auth-methods";
import { createClient } from "@/lib/supabase/server";
import { SettingRow, SettingsSection } from "../setting-row";
import { DeleteAccount } from "./account-client";

export const metadata = { title: "Account · Saylent" };

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", user!.id)
    .maybeSingle();

  // Derived from NEXT_PUBLIC_AUTH_METHODS, exactly like the login card, so this
  // row can never again claim a sign-in method the deployment does not use
  //.
  const recovery = signInRecoveryCopy(authMethods());

  return (
    <SettingsSection title="Account" description="Permanent actions for your whole account.">
      {/* GDPR Art. 20 — download my data. A plain same-origin GET link: the
          route sets Content-Disposition, so the browser downloads it; cookies
          ride along, so it is auth-gated to this user's own data. */}
      <SettingRow
        label="Download my data"
        description="Export everything we hold about your account (profile, brands, runs, scores, answers and fixes) as one JSON file."
      >
        <a
          href="/api/account/export"
          className={buttonVariants({ variant: "outline" })}
        >
          Download my data
        </a>
      </SettingRow>

      {/* IDENTITY recovery note, derived from the deployment's own auth config. */}
      <SettingRow
        label="Sign-in and recovery"
        description={
          <>
            {recovery.sentence}{" "}
            {recovery.showReset && (
              <>
                <Link href="/auth/reset" className="text-ink underline underline-offset-2">
                  Reset your password
                </Link>
                {". "}
              </>
            )}
            Locked out entirely?{" "}
            <Link href="/app/support" className="text-ink underline underline-offset-2">
              Contact support
            </Link>{" "}
            and whoever operates this deployment can help you recover the account.
          </>
        }
      />

      <DeleteAccount email={profile?.email ?? user?.email ?? ""} />
    </SettingsSection>
  );
}
