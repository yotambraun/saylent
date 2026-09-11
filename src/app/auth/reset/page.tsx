// /auth/reset — "email me a reset link". Supabase sends the mail; the link lands
// on /auth/callback (the only route that exchanges the code for a session) and
// is forwarded to /auth/reset/update, where the new password is actually set.
import Link from "next/link";
import { ResetRequestForm } from "./reset-request-form";

export const metadata = { title: "Reset your password · Saylent" };

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <Link href="/" className="font-display text-3xl font-semibold tracking-tight">
        Saylent
      </Link>
      <ResetRequestForm />
      <Link href="/login" className="text-xs text-wire underline">
        ← Back to sign in
      </Link>
    </main>
  );
}
