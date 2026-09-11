// The global 404.
//
// It used to send everyone to "/" — but on a self-hosted deployment "/" is not a
// marketing site, it redirects (src/app/root-redirect.ts): anonymous → /login,
// signed in → /app. So the primary button bounced a signed-out stranger straight
// back to the sign-in form they were already looking at. The
// destination now depends on whether there is a session, and the secondary link
// points at the one page that always exists for everyone.
import Link from "next/link";
import { Button } from "@saylent/report/ui/button";
import { createClient } from "@/lib/supabase/server";

export default async function NotFound() {
  // A read failure here must not turn a 404 into a 500 — fall back to the
  // signed-out wording, which is correct for a stranger and harmless for a user.
  let signedIn = false;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = !!user;
  } catch {
    signedIn = false;
  }

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-wire">
        404 · page not found
      </p>
      <h1 className="max-w-xl font-display text-4xl leading-tight">
        This page isn&apos;t in the answer.
      </h1>
      <p className="max-w-md text-ink/70">
        The address doesn&apos;t exist. Unlike the engines, we won&apos;t guess.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Button asChild>
          <Link href={signedIn ? "/app" : "/login"}>{signedIn ? "Dashboard" : "Sign in"}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/demo">See a sample report</Link>
        </Button>
      </div>
    </div>
  );
}
