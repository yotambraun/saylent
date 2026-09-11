// The in-app "Contact support" surface. A form that
// creates a tracked support_requests row (POST /api/support), not a mailto to a
// dead address. Authed: the user's id + latest run/brand context auto-attach
// server-side. Links out to the self-service surfaces (help + status) so a user
// can often answer themselves without a ticket.
import Link from "next/link";
import { emailConfigured } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";
import { SupportForm } from "./support-form";

export const metadata = { title: "Contact support · Saylent" };

export default async function SupportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const canEmail = emailConfigured();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl">Contact support</h1>
        {/* Honest about where this goes. On a fresh self-host
            RESEND_API_KEY / EMAIL_FROM are unset, so nothing is emailed to
            anyone — the message lands in /admin/support and waits for the
            operator to look. Say the true thing in both cases. */}
        <p className="mt-1 text-sm text-wire">
          {canEmail
            ? "Tell us what's going on and whoever operates this deployment will get back to you by email."
            : "Tell us what's going on. This goes to whoever operates this deployment, in their admin console."}{" "}
          Your account and most recent audit are attached automatically, so you don&apos;t have
          to explain the setup.
        </p>
        {!canEmail && (
          <p className="mt-2 text-xs text-wire">
            This deployment has no outbound email configured yet, so there is no automatic
            reply — the operator sees your message when they next open the console.
          </p>
        )}
      </div>

      <SupportForm defaultEmail={user?.email ?? ""} />

      <p className="text-sm text-wire">
        Looking for a quick answer first?{" "}
        <Link href="/help" className="text-ink underline underline-offset-2">
          Help &amp; FAQ
        </Link>{" "}
        ·{" "}
        <Link href="/status" className="text-ink underline underline-offset-2">
          System status
        </Link>
      </p>
    </div>
  );
}
