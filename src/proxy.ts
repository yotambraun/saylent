// Proxy refreshes sessions and protects /app/* → /login
// (Next 16 renamed the deprecated `middleware` file convention to `proxy`;
//  behavior is identical — see node_modules/next/dist/docs/.../proxy.md)
//
// CSP enforce+nonce: the enforced
// Content-Security-Policy is minted HERE, per request, because App Router streams its
// bootstrap + flight-data inline scripts which have no stable hash. Next injects a
// nonce into those scripts when it finds a `'nonce-…'` in the request's CSP header, so
// the proxy generates a nonce, threads it onto the FORWARDED request headers (x-nonce +
// Content-Security-Policy) and echoes the same policy on the response.
// See node_modules/next/dist/METHODOLOGY.md-app/02-guides/content-security-policy.md
// ("Adding a nonce with Proxy" + "How nonces work in Next.js"). The next.config.ts
// Report-Only header stays for bake-in comparison.
import { createHash } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clampDemoSessionCookie, demoCredentials, isDemoReadOnly } from "./lib/demo-mode";
import { flag } from "./lib/flags";
import { THEME_SCRIPT } from "./lib/theme-script";

// SHA-256 of the exact inline theme script layout.tsx emits — the pre-paint no-FOUC
// theme + `js` setter. Allow-listed by hash so that one parser-inserted inline script
// runs without a nonce.
//
// DERIVED, never typed. A hand-maintained literal drifted from the script once
// (2026-09-10: a `js` class was added, the constant was not recomputed, and the browser
// refused the script on every /app, /login and /share page). Proxy runs on the Node.js
// runtime in Next 16 (node_modules/next/dist/docs/.../proxy.md#runtime), so node:crypto
// is available and this costs one hash at module load.
export const THEME_SCRIPT_HASH = `sha256-${createHash("sha256")
  .update(THEME_SCRIPT, "utf8")
  .digest("base64")}`;

/** Build the ENFORCED Content-Security-Policy for one request. Pure over its inputs so
 *  it is unit-testable. `'strict-dynamic'` lets the nonce'd Next bootstrap load the
 *  hashed chunk scripts (CSP3 ignores the host allowlist for script once it is present;
 *  the theme hash and nonce are still honored). Directives are NOT weakened vs. the prior
 *  Report-Only policy — img-src drops the remote `https:` because host favicons are now
 *  self-proxied through /api/favicon. Dev adds `'unsafe-eval'` (React debug) + `ws:` (HMR). */
export function buildContentSecurityPolicy(
  nonce: string,
  { dev = false }: { dev?: boolean } = {},
): string {
  // Supabase realtime uses wss:; REST/storage use https:. Wildcarded so the same policy
  // holds across the dev/preview/prod Supabase projects.
  const supabase = "https://*.supabase.co wss://*.supabase.co";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' '${THEME_SCRIPT_HASH}'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabase}${dev ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

function isAuthPath(path: string): boolean {
  return (
    path.startsWith("/app") ||
    path.startsWith("/admin") ||
    path === "/login" ||
    path.startsWith("/auth")
  );
}

/** Enforced CSP can only land where Next renders per-request: prerendered (static ○)
 *  marketing HTML is served from the build cache and can never carry this request's
 *  nonce — enforcing there would block every inline bootstrap script (verified live
 *  2026-07-19: `/` served 16 nonce-less inline scripts under the enforced header).
 *  Static routes keep the Report-Only policy from next.config.ts. Keep this list in
 *  sync with the ƒ (Dynamic) HTML routes in the `next build` route table. */
export function isDynamicHtmlPath(path: string): boolean {
  return isAuthPath(path) || path.startsWith("/share") || path === "/takedown";
}

/** Hosted read-only demo — should this request be signed
 *  in as the shared demo account? ONLY on a demo deployment, ONLY for a visitor with
 *  no session of their own, ONLY under /app (never /admin: the operator console stays
 *  behind a real login), and only when the demo credentials are configured. Pure over
 *  its inputs so the routing rule is unit-tested without a Supabase round-trip. */
export function shouldMintDemoSession(p: {
  path: string;
  hasUser: boolean;
  demoOn: boolean;
  hasCredentials: boolean;
}): boolean {
  return p.demoOn && p.hasCredentials && !p.hasUser && p.path.startsWith("/app");
}

export async function proxy(request: NextRequest) {
  const dev = process.env.NODE_ENV !== "production";
  // FLAG_CSP_ENFORCE (default ON). Off → no nonce/CSP header is minted and the proxy
  // behaves exactly as before (Report-Only from next.config.ts remains the only CSP).
  // Nonce: base64 of a random UUID (crypto.randomUUID + btoa are both Edge-runtime
  // globals) — unpredictable and unique per request, per the Next CSP guide.
  const enforce = flag("cspEnforce") && isDynamicHtmlPath(request.nextUrl.pathname);
  const nonce = enforce ? btoa(crypto.randomUUID()) : undefined;
  const csp = nonce ? buildContentSecurityPolicy(nonce, { dev }) : null;

  // Headers forwarded to the render. Re-read request.headers each call so cookie
  // refreshes performed by Supabase (which mutate request.cookies) are picked up.
  const forwardHeaders = () => {
    const h = new Headers(request.headers);
    if (csp && nonce) {
      h.set("x-nonce", nonce);
      h.set("Content-Security-Policy", csp);
    }
    return h;
  };
  const withCsp = (res: NextResponse) => {
    if (csp) res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  const path = request.nextUrl.pathname;

  // Dynamic non-auth routes (/share, /takedown): enforced CSP + nonce only — no
  // Supabase round-trip. Static routes never reach the proxy (see matcher).
  if (!isAuthPath(path)) {
    return withCsp(NextResponse.next({ request: { headers: forwardHeaders() } }));
  }

  let response = NextResponse.next({ request: { headers: forwardHeaders() } });

  // True only while the demo sign-in below is writing ITS
  // cookies, so a real operator's session is never shortened. Set before the
  // signInWithPassword call because that is what triggers setAll.
  let mintingDemoSession = false;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: forwardHeaders() } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(
              name,
              value,
              mintingDemoSession ? clampDemoSessionCookie(options) : options,
            ),
          );
        },
      },
    },
  );

  // IMPORTANT: getUser() (validates against Supabase), not getSession()
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Hosted read-only demo: mint a
  // REAL session for the shared demo account so every /app loader keeps running under
  // RLS as a real user — no loader knows the demo exists, and RLS can only ever expose
  // the demo account's own seeded rows. signInWithPassword writes its cookies through
  // the adapter above, which rebuilds `response` with them attached. A failed sign-in
  // falls through to the normal /login redirect (fail closed, never a redirect loop).
  // Writes are refused separately by assertNotDemo() in every mutation.
  let viewer = user;
  const demoCreds = isDemoReadOnly() ? demoCredentials() : null;
  if (shouldMintDemoSession({ path, hasUser: !!user, demoOn: isDemoReadOnly(), hasCredentials: !!demoCreds })) {
    // The minted session is capped at DEMO_SESSION_MAX_AGE_SECONDS (#22): a demo
    // login must not outlive the flag that justified it. A visitor still reading
    // gets a fresh one on the next request — but only while the flag is on.
    mintingDemoSession = true;
    try {
      const { data, error } = await supabase.auth.signInWithPassword(demoCreds!);
      if (!error) viewer = data.user;
    } finally {
      mintingDemoSession = false;
    }
  }

  if (!viewer && (path.startsWith("/app") || path.startsWith("/admin"))) {
    // proxy only ensures a session + refresh; the admin ROLE check lives in
    // requireAdmin(). Unauthenticated /admin* → /login, mirroring /app.
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return withCsp(NextResponse.redirect(url));
  }
  if (viewer && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    return withCsp(NextResponse.redirect(url));
  }
  return withCsp(response);
}

export const config = {
  // SEC-HARDEN: the nonce'd enforced CSP only works on per-request-rendered HTML
  // (isDynamicHtmlPath) — static marketing pages are cache-served and keep the
  // Report-Only header from next.config.ts — so match exactly the dynamic HTML
  // routes. Skip next/link prefetches — they don't need the header.
  // See node_modules/next/dist/METHODOLOGY.md-app/02-guides/content-security-policy.md.
  matcher: [
    "/app/:path*",
    "/admin/:path*",
    "/login",
    "/auth/:path*",
    "/share/:path*",
    "/takedown",
  ],
};
