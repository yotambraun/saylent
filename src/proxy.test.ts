// SEC-HARDEN CSP enforce+nonce — the CSP string builder is pure, so pin its shape here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DEMO_SESSION_MAX_AGE_SECONDS } from "./lib/demo-mode";

/** What the fake Supabase client writes through the cookie adapter, and when. */
const supabaseFake = vi.hoisted(() => ({
  /** null = nobody is signed in (the demo path) */
  user: null as { id: string } | null,
  /** cookies a session REFRESH writes (getUser), i.e. a real user's session */
  refreshCookies: [] as { name: string; value: string; options?: Record<string, unknown> }[],
  /** cookies the demo sign-in writes */
  signInCookies: [] as { name: string; value: string; options?: Record<string, unknown> }[],
  signInCalls: 0,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { setAll: (c: unknown[]) => void } },
  ) => ({
    auth: {
      getUser: async () => {
        if (supabaseFake.refreshCookies.length > 0) opts.cookies.setAll(supabaseFake.refreshCookies);
        return { data: { user: supabaseFake.user } };
      },
      signInWithPassword: async () => {
        supabaseFake.signInCalls += 1;
        opts.cookies.setAll(supabaseFake.signInCookies);
        return { data: { user: { id: "demo-user" } }, error: null };
      },
    },
  }),
}));

const { buildContentSecurityPolicy, isDynamicHtmlPath, proxy, shouldMintDemoSession } =
  await import("./proxy");

const NONCE = "abc123==";

describe("buildContentSecurityPolicy", () => {
  it("embeds the per-request nonce in script-src", () => {
    const csp = buildContentSecurityPolicy(NONCE);
    expect(csp).toContain(`'nonce-${NONCE}'`);
    expect(csp).toMatch(/script-src [^;]*'nonce-abc123=='/);
  });

  it("keeps strict-dynamic and the theme-script hash alongside the nonce", () => {
    const csp = buildContentSecurityPolicy(NONCE);
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("'sha256-");
  });

  it("does not weaken the hardening directives", () => {
    const csp = buildContentSecurityPolicy(NONCE);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("scopes img-src to self + data: (favicons are self-proxied)", () => {
    const csp = buildContentSecurityPolicy(NONCE);
    expect(csp).toMatch(/img-src 'self' data:(;|$)/);
    expect(csp).not.toContain("img-src 'self' data: https:");
  });

  it("adds unsafe-eval and ws: only in dev", () => {
    const prod = buildContentSecurityPolicy(NONCE, { dev: false });
    const dev = buildContentSecurityPolicy(NONCE, { dev: true });
    expect(prod).not.toContain("'unsafe-eval'");
    expect(prod).not.toContain("ws:");
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("ws:");
  });

  it("never emits 'unsafe-inline' in script-src (nonce replaces it)", () => {
    const scriptSrc = buildContentSecurityPolicy(NONCE, { dev: true })
      .split(";")
      .find((d) => d.trim().startsWith("script-src"))!;
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });
});

describe("isDynamicHtmlPath (enforced-CSP scope)", () => {
  it("covers every per-request-rendered HTML route", () => {
    for (const p of [
      "/app",
      "/app/run/abc",
      "/admin",
      "/admin/users/1",
      "/login",
      "/auth/callback",
      "/share/tok123",
      "/takedown",
    ]) {
      expect(isDynamicHtmlPath(p), p).toBe(true);
    }
  });

  it("excludes static prerendered routes — their cached HTML can never carry a nonce", () => {
    for (const p of ["/demo", "/methodology", "/about", "/help", "/status", "/privacy", "/terms"]) {
      expect(isDynamicHtmlPath(p), p).toBe(false);
    }
  });
});

// Hosted read-only demo — the routing rule that turns an
// anonymous visitor into the shared demo account. Getting this wrong either breaks the
// demo or (far worse) hands a stranger a session on a NON-demo deployment.
describe("shouldMintDemoSession (hosted read-only demo)", () => {
  const on = { path: "/app", hasUser: false, demoOn: true, hasCredentials: true };

  it("signs an anonymous /app visitor in as the demo account when the flag is on", () => {
    for (const path of ["/app", "/app/run/abc", "/app/settings/brands", "/app/compare"]) {
      expect(shouldMintDemoSession({ ...on, path }), path).toBe(true);
    }
  });

  it("NEVER mints a session when the demo flag is off — the normal product is untouched", () => {
    expect(shouldMintDemoSession({ ...on, demoOn: false })).toBe(false);
  });

  it("never mints a session for /admin — the operator console stays behind a real login", () => {
    for (const path of ["/admin", "/admin/users/1"]) {
      expect(shouldMintDemoSession({ ...on, path }), path).toBe(false);
    }
  });

  it("leaves a real signed-in user alone (the operator keeps their own session)", () => {
    expect(shouldMintDemoSession({ ...on, hasUser: true })).toBe(false);
  });

  it("fails closed when the demo credentials are not configured", () => {
    expect(shouldMintDemoSession({ ...on, hasCredentials: false })).toBe(false);
  });

  it("does not hijack /login or /auth — the demo notice + real sign-in live there", () => {
    for (const path of ["/login", "/auth/callback"]) {
      expect(shouldMintDemoSession({ ...on, path }), path).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The proxy signs demo visitors in with signInWithPassword,
// and Supabase's own cookies last weeks. That is a real login to the shared demo
// account which outlives the flag: turn NEXT_PUBLIC_DEMO_READONLY off and every
// visitor who ever opened /app still holds a session on a deployment where
// assertNotDemo() no longer refuses anything.
// ---------------------------------------------------------------------------
const THIRTY_DAYS = 60 * 60 * 24 * 30;
const SAVED = { ...process.env };

describe("demo sessions are short-lived (#22)", () => {
  beforeEach(() => {
    supabaseFake.user = null;
    supabaseFake.refreshCookies = [];
    supabaseFake.signInCalls = 0;
    supabaseFake.signInCookies = [
      {
        name: "sb-demo-auth-token",
        value: "token",
        options: { maxAge: THIRTY_DAYS, path: "/", httpOnly: true },
      },
    ];
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://demo.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.NEXT_PUBLIC_DEMO_READONLY = "1";
    process.env.DEMO_USER_EMAIL = "demo@example.com";
    process.env["DEMO_USER_PASSWORD"] = ["throw", "away"].join("");
  });

  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("caps the minted demo cookie at one hour instead of Supabase's thirty days", async () => {
    const res = await proxy(new NextRequest("https://demo.example.com/app"));

    expect(supabaseFake.signInCalls).toBe(1);
    const cookie = res.cookies.get("sb-demo-auth-token");
    expect(cookie?.maxAge).toBe(DEMO_SESSION_MAX_AGE_SECONDS);
    expect(DEMO_SESSION_MAX_AGE_SECONDS).toBeLessThanOrEqual(3600);
    expect(cookie?.maxAge).toBeLessThan(THIRTY_DAYS);
  });

  it("respects a SHORTER lifetime Supabase asked for", async () => {
    supabaseFake.signInCookies = [
      { name: "sb-demo-auth-token", value: "t", options: { maxAge: 120, path: "/" } },
    ];

    const res = await proxy(new NextRequest("https://demo.example.com/app"));

    expect(res.cookies.get("sb-demo-auth-token")?.maxAge).toBe(120);
  });

  it("does NOT shorten a real user's session refresh on the same deployment", async () => {
    // the operator signing in to /admin on the demo project keeps a normal session
    supabaseFake.user = { id: "operator-1" };
    supabaseFake.refreshCookies = [
      {
        name: "sb-demo-auth-token",
        value: "operator",
        options: { maxAge: THIRTY_DAYS, path: "/" },
      },
    ];

    const res = await proxy(new NextRequest("https://demo.example.com/app"));

    expect(supabaseFake.signInCalls).toBe(0);
    expect(res.cookies.get("sb-demo-auth-token")?.maxAge).toBe(THIRTY_DAYS);
  });

  it("mints nothing once the flag is off — the demo is over", async () => {
    delete process.env.NEXT_PUBLIC_DEMO_READONLY;

    const res = await proxy(new NextRequest("https://demo.example.com/app"));

    expect(supabaseFake.signInCalls).toBe(0);
    // anonymous visitor on a non-demo deployment → /login, as always
    expect(res.headers.get("location")).toContain("/login");
  });
});
