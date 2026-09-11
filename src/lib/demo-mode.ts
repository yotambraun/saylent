// Hosted read-only demo — the demo-mode switch.
//
// A public deployment of the app where anyone can click through the dashboard, the
// summary, the full report, compare, movement and settings for the seeded Kestrel
// Uptime brand WITHOUT logging in and WITHOUT being able to change anything, at $0
// per visitor (no LLM call is reachable — every run-creation path refuses).
//
// DESIGN (chosen over a service-role read path):
//   The app has ~30 page loaders that all resolve the viewer from
//   `supabase.auth.getUser()` on the RLS client and rely on RLS for scoping.
//   Swapping in a service-role client keyed to a demo user id would mean editing
//   every loader AND dropping RLS (each query would then need an explicit user_id
//   filter — a security regression on the real product for the sake of the demo).
//   So demo mode instead mints a REAL Supabase session for one shared demo account
//   (src/proxy.ts, on the first unauthenticated /app request). The visitor genuinely
//   IS the demo user: RLS is untouched and can only ever expose demo-owned rows, and
//   not one loader changes. Writes are then refused in one place per mutation —
//   `assertNotDemo()` at the top of every server action and inside `createRun`.
//
// This module is pure over `process.env` reads (no `server-only`, no imports) so the
// proxy, server actions, the seed script and the tests can all use it.

/** Env var names, in one place so the seed script and docs cannot drift. */
export const DEMO_ENV = {
  flag: "NEXT_PUBLIC_DEMO_READONLY",
  email: "DEMO_USER_EMAIL",
  password: "DEMO_USER_PASSWORD",
} as const;

/** The brand the demo is seeded with (fixtures/run.json). */
export const DEMO_BRAND_NAME = "Kestrel Uptime";

/** The one message every blocked mutation returns. Plain, honest, no jargon. */
export const DEMO_READ_ONLY_MESSAGE =
  "This is a read-only demo — nothing here can be changed. Run it on your own brand: npx saylent audit <domain>";

const TRUTHY = new Set(["1", "true", "on", "yes"]);

/** Is this deployment the hosted read-only demo? Reads the PUBLIC flag so the same
 *  answer holds on the server and in the browser bundle (Next inlines it at build). */
export function isDemoReadOnly(raw = process.env.NEXT_PUBLIC_DEMO_READONLY): boolean {
  return TRUTHY.has((raw ?? "").trim().toLowerCase());
}

export type DemoCredentials = { email: string; password: string };

/** The shared demo account the proxy signs visitors in as. Server-only vars — never
 *  read from a client component. `null` when either is missing: demo mode then simply
 *  fails closed (the proxy falls through to the normal /login redirect). */
export function demoCredentials(
  email = process.env.DEMO_USER_EMAIL,
  password = process.env.DEMO_USER_PASSWORD,
): DemoCredentials | null {
  const e = email?.trim();
  if (!e || !password) return null;
  return { email: e, password };
}

// ── session lifetime ────────────────────────────────────────────────────────
/**
 * How long a minted demo session may live in the visitor's browser.
 *
 * The proxy signs a visitor in with `signInWithPassword`, and Supabase hands
 * back its normal long-lived session cookies (weeks, silently refreshed). That
 * session is a REAL login to the shared demo account, so it used to outlive the
 * thing that justified it: turn `NEXT_PUBLIC_DEMO_READONLY` off — because the
 * demo is over, or because the project is being repurposed — and every visitor
 * who ever opened /app still holds a valid session for that account, now on a
 * deployment where `assertNotDemo()` no longer refuses a single write.
 *
 * One hour is longer than anyone spends reading a sample dossier and short
 * enough that "flag off" means "everyone is out within the hour". A visitor who
 * is still browsing simply gets a fresh session on their next /app request —
 * but ONLY while the flag is still on.
 */
export const DEMO_SESSION_MAX_AGE_SECONDS = 60 * 60;

/**
 * Cap one Supabase auth cookie at the demo lifetime. Pure over its inputs (the
 * cookie options Supabase asked for) so the rule is unit-tested without a
 * browser: a shorter request is respected, a longer one is cut to the cap, and a
 * missing one becomes the cap rather than a session cookie of unknown length.
 */
export function clampDemoSessionCookie<T extends { maxAge?: number; expires?: Date }>(
  options: T | undefined,
  now: number = Date.now(),
): Omit<T, "maxAge" | "expires"> & { maxAge: number; expires?: Date } {
  const requested =
    typeof options?.maxAge === "number" && Number.isFinite(options.maxAge)
      ? options.maxAge
      : DEMO_SESSION_MAX_AGE_SECONDS;
  const maxAge = Math.max(0, Math.min(requested, DEMO_SESSION_MAX_AGE_SECONDS));
  const out = { ...(options ?? ({} as T)), maxAge };
  // Supabase may send `expires` too; a cookie is dead at whichever comes first,
  // so keep the two honest with each other.
  if (out.expires !== undefined) out.expires = new Date(now + maxAge * 1000);
  return out;
}

/** The shape every blocked mutation returns. Carries BOTH `error` (server actions)
 *  and `reason` (createRun / the /api/runs contract) so one object satisfies every
 *  call site without widening any existing return type. */
export type DemoBlocked = { ok: false; error: string; reason: string; demo: true };

/** THE write guard. Call it as the FIRST statement of any mutation:
 *
 *      const demo = assertNotDemo();
 *      if (demo) return demo;
 *
 *  Returns `null` (fall through) on every non-demo deployment, so the normal product
 *  is byte-for-byte unchanged when the flag is off. */
export function assertNotDemo(raw?: string): DemoBlocked | null {
  if (!isDemoReadOnly(raw ?? process.env.NEXT_PUBLIC_DEMO_READONLY)) return null;
  return {
    ok: false,
    error: DEMO_READ_ONLY_MESSAGE,
    reason: DEMO_READ_ONLY_MESSAGE,
    demo: true,
  };
}
