// /login: one card (password, magic link, Google) with brand context — the
// wordmark plus a one-liner — so a cold visitor is never stranded.
//
// NOTHING HERE LINKS TO "/". On a self-hosted deployment "/" is a
// redirect, not a site: anonymous visitors land right back on this form. The
// wordmark is therefore plain text (this IS the page), and the footer points at
// the two pages an anonymous visitor can actually read.
import Link from "next/link";
import { DEMO_BRAND_NAME, isDemoReadOnly } from "@/lib/demo-mode";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Saylent" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // /auth/callback redirects a dead/expired magic link to ?error=auth. Read it so
  // the visitor gets an honest reason instead of a silently reset form.
  const { error } = await searchParams;
  const authFailed = error === "auth";
  // Hosted read-only demo: a visitor who lands on /login
  // needs no account — one click enters the demo (the proxy mints the shared demo
  // session). The real sign-in form stays below so the operator can still get in.
  const demo = isDemoReadOnly();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="font-display text-3xl font-semibold tracking-tight">Saylent</p>
        <p className="max-w-sm text-sm text-wire">
          See exactly how ChatGPT, Claude, Gemini and Perplexity answer your buyers: with
          receipts and fixes.
        </p>
      </div>
      {authFailed && (
        <p
          role="alert"
          className="max-w-sm rounded-md border border-line bg-card px-4 py-3 text-center text-sm text-pill-dismissed"
        >
          That sign-in link didn&apos;t work. It may have expired. Enter your email for a
          fresh one.
        </p>
      )}
      {demo && (
        <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-md border border-line bg-card px-5 py-5 text-center">
          <p className="text-sm text-wire">
            This is the <strong className="font-semibold text-ink">read-only demo</strong>. No
            account needed. Walk through a finished audit of {DEMO_BRAND_NAME}, a fictional
            company we audit. Nothing you click can change anything.
          </p>
          <Link
            href="/app"
            className="w-full rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper hover:opacity-90"
          >
            Continue to the demo
          </Link>
          <p className="text-xs text-wire">Running your own copy? Sign in below.</p>
        </div>
      )}
      <LoginForm />
      <p className="flex flex-wrap items-center justify-center gap-3 text-xs text-wire">
        <Link href="/demo" className="underline">
          See a sample report
        </Link>
        <span aria-hidden="true">·</span>
        <Link href="/help" className="underline">
          Help &amp; FAQ
        </Link>
      </p>
    </main>
  );
}
