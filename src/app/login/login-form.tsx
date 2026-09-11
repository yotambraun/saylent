"use client";
// The sign-in card: ONE email field, a password, and — when the operator enabled
// it — a secondary "email me a sign-in link" button. Google OAuth last.
//
// A usability review found two things wrong with the old card:
//   #9  it rendered two inputs both labelled exactly "Email", both placeholdered
//       `you@company.com`, with a thin "or" between them. A stranger cannot tell
//       which one to type into, and a password manager fills the wrong one.
//       There is now one email field, shared by both buttons.
//   #11 the magic-link failure said "Check the address and try again", blaming
//       the address for a deployment that simply has no SMTP. Every auth error
//       now goes through auth-copy.ts, which says what actually happened; the
//       raw library string goes to the console for the operator (#10).
//
// A self-hosted or local deployment usually has no SMTP configured, so email +
// password is the reliable path and leads the card. Both use the same
// @supabase/ssr browser client and need no new route (signInWithPassword/signUp
// set the session cookie directly and the page navigates client-side, so the
// server callback route stays magic-link/OAuth/recovery only).
// NEXT_PUBLIC_AUTH_METHODS (csv of "password" | "magic-link" | "google", default
// "password,magic-link") controls which sections render — see scripts/check-env.ts.
//
// Every failure paragraph carries role="alert": these messages replace content
// the user is looking away from (they just clicked a button), so a screen reader
// has to be told, not left to discover it.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@saylent/report/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@saylent/report/ui/card";
import { Input } from "@saylent/report/ui/input";
import { Label } from "@saylent/report/ui/label";
import { authErrorCopy } from "./auth-copy";

const AUTH_METHODS = (process.env.NEXT_PUBLIC_AUTH_METHODS ?? "password,magic-link")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const SHOW_PASSWORD = AUTH_METHODS.includes("password");
const SHOW_MAGIC_LINK = AUTH_METHODS.includes("magic-link");
const SHOW_GOOGLE = AUTH_METHODS.includes("google");

type PwMode = "signin" | "signup";
type Phase = "idle" | "password" | "magic-link";

export function LoginForm() {
  const router = useRouter();

  // ONE email, shared by the password submit and the magic-link button (#9).
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pwMode, setPwMode] = useState<PwMode>("signin");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<"magic-link" | "confirm" | null>(null);

  const busy = phase !== "idle";

  /** The one place a raw Supabase message is handled: product copy for the
   *  person, the raw string for whoever has the console open. */
  function fail(raw: string, action: "signin" | "signup" | "magic-link") {
    console.error("[auth]", action, raw);
    setError(authErrorCopy(raw, action));
    setPhase("idle");
  }

  async function sendMagicLink() {
    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }
    setPhase("magic-link");
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (err) return fail(err.message, "magic-link");
    setPhase("idle");
    setSent("magic-link");
  }

  async function signInWithGoogle() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setPhase("password");
    setError(null);
    const supabase = createClient();
    if (pwMode === "signin") {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) return fail(err.message, "signin");
      router.push("/app");
      router.refresh();
      return;
    }
    // signup — same emailRedirectTo as the magic link so /auth/callback (already
    // handles any exchangeCodeForSession) covers confirmation links too.
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (err) return fail(err.message, "signup");
    if (data.session) {
      // email confirmations off (local dev default, supabase/config.toml) — the
      // account is live immediately.
      router.push("/app");
      router.refresh();
      return;
    }
    setPhase("idle");
    setSent("confirm");
  }

  if (sent === "magic-link") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-display">Check your inbox</CardTitle>
          <CardDescription>The link signs you in: no password needed.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-wire">
            Sent to <span className="font-mono">{email}</span>. Nothing after a minute? This
            deployment may not have email configured — sign in with a password instead.{" "}
            <button className="underline" onClick={() => setSent(null)}>
              Back to sign in
            </button>
          </p>
        </CardContent>
      </Card>
    );
  }

  if (sent === "confirm") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-display">Confirm your email</CardTitle>
          <CardDescription>One more step before you can sign in.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-wire">
            We sent a confirmation link to <span className="font-mono">{email}</span>. Open it,
            then come back and sign in.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="font-display text-2xl">Sign in to Saylent</CardTitle>
        <CardDescription>
          {SHOW_PASSWORD
            ? "Sign in, or create an account below."
            : "New here? The same link creates your account."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form onSubmit={submitPassword} noValidate className="grid gap-3">
          {/* The one email field. autoComplete="username" (not "email") is what a
              password manager needs to pair it with the password below. */}
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
            />
          </div>

          {SHOW_PASSWORD && (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="pw-password">Password</Label>
                <Input
                  id="pw-password"
                  type="password"
                  minLength={6}
                  autoComplete={pwMode === "signin" ? "current-password" : "new-password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                />
              </div>
              <Button type="submit" disabled={busy}>
                {phase === "password"
                  ? "Working…"
                  : pwMode === "signin"
                    ? "Sign in"
                    : "Create account"}
              </Button>
            </>
          )}

          {error && (
            <p role="alert" className="text-sm text-pill-dismissed">
              {error}
            </p>
          )}

          {SHOW_PASSWORD && pwMode === "signin" && (
            <p className="text-center text-xs text-wire">
              <Link href="/auth/reset" className="underline">
                Forgot your password?
              </Link>
            </p>
          )}
          {SHOW_PASSWORD && (
            <p className="text-center text-xs text-wire">
              {pwMode === "signin" ? "New here? " : "Already have an account? "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setPwMode(pwMode === "signin" ? "signup" : "signin");
                  setError(null);
                }}
              >
                {pwMode === "signin" ? "Create an account" : "Sign in"}
              </button>
            </p>
          )}
        </form>

        {SHOW_MAGIC_LINK && (
          <div className="grid gap-1.5 border-t border-line pt-4">
            <Button
              type="button"
              variant={SHOW_PASSWORD ? "outline" : "default"}
              disabled={busy}
              onClick={sendMagicLink}
            >
              {phase === "magic-link" ? "Sending…" : "Or email me a sign-in link"}
            </Button>
            {/* Honest about what this needs. Supabase Auth sends the link, so the
                app cannot probe whether SMTP is configured — say so rather than
                promise delivery, and let auth-copy.ts explain a real failure. */}
            <p className="text-center text-xs text-wire">
              Uses the email above. Needs email set up on this deployment; if none arrives, use
              a password.
            </p>
          </div>
        )}

        {SHOW_GOOGLE && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={signInWithGoogle}
            className={SHOW_PASSWORD || SHOW_MAGIC_LINK ? "border-t-0" : undefined}
          >
            Continue with Google
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
