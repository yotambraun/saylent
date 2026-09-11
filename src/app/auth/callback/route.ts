// Auth code exchange for magic-link, Google OAuth and password recovery. The
// recovery link from /auth/reset arrives here too, with ?next=/auth/reset/update
// — the session minted below is what lets that page call updateUser.
import { NextResponse } from "next/server";
import { track } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/server";

/** Where an auth callback lands when `next` is missing or not trustworthy. */
export const DEFAULT_NEXT = "/app";

/**
 * Open-redirect guard. `?next=` is attacker-controlled: a link with
 * `next=@evil.com`, `next=//evil.com` or `next=/\evil.com` used to be pasted
 * straight after `origin`, and every browser reads `https://site.com@evil.com`
 * or `https://site.com//evil.com` as a hop to evil.com — a credible phish,
 * because the link really did start on our domain and really did sign the
 * victim in.
 *
 * So: accept ONLY a same-origin absolute PATH. It must start with a single "/"
 * that is not followed by another "/" or a "\" (both are scheme-relative to a
 * browser), must not contain a control character (a raw CR/LF would split the
 * header), and must not itself parse as an absolute URL. Anything else — an
 * absolute URL, a protocol-relative URL, a bare "evil.com", "@evil.com",
 * "javascript:…" — falls back to /app. Pure, so the test can enumerate the
 * payloads without a Supabase round trip.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== "string") return DEFAULT_NEXT;
  const next = raw.trim();
  if (!next) return DEFAULT_NEXT;
  // control characters (a raw CR/LF would split the redirect header)
  if (/[\u0000-\u001f\u007f]/.test(next)) return DEFAULT_NEXT;
  if (!next.startsWith("/")) return DEFAULT_NEXT;
  if (next.startsWith("//") || next.startsWith("/\\")) return DEFAULT_NEXT;
  // Backslashes are normalized to "/" by browsers in some positions — never
  // worth the ambiguity on a redirect target.
  if (next.includes("\\")) return DEFAULT_NEXT;
  return next;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // signup — the account-creation chokepoint. This handler also
      // runs on every returning magic-link login, so we only count it as a signup
      // when the account was just created (created_at within the last 2 min).
      // track() never throws, so a tracking blip can't break sign-in.
      const user = data.user;
      if (user?.created_at && Date.now() - new Date(user.created_at).getTime() < 120_000) {
        await track("signup", { userId: user.id });
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
