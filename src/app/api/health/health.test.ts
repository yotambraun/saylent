// /api/health is unauthenticated by design (it is the uptime
// monitor's target), and it used to answer a stranger with the deployment's
// whole configuration: exactly which migration files are NOT applied here, which
// login methods are enabled, which providers are wired, whether email works, and
// the operator's daily spend cap. That is a free reconnaissance report.
import { beforeEach, describe, expect, it, vi } from "vitest";

let role: string | null = null;
let user: { id: string } | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        limit: async () => ({ data: [{ id: "p1" }], error: null }),
        // _migrations
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
      }),
    }),
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: role ? { role } : null }) }),
      }),
    }),
  }),
}));

const { GET, hasSupabaseSessionCookie, publicHealth } = await import("./route");

const CONFIG_KEYS = ["migrations", "auth_methods", "providers", "email", "budget"];

beforeEach(() => {
  role = null;
  user = null;
});

describe("hasSupabaseSessionCookie — an uptime probe never costs an auth call", () => {
  it("is false with no cookie header at all", () => {
    expect(hasSupabaseSessionCookie(null)).toBe(false);
    expect(hasSupabaseSessionCookie("")).toBe(false);
  });

  it("is false for unrelated cookies", () => {
    expect(hasSupabaseSessionCookie("theme=dark; _ga=1")).toBe(false);
    expect(hasSupabaseSessionCookie("not-sb-auth=1")).toBe(false);
  });

  it("is true for a Supabase auth cookie", () => {
    expect(hasSupabaseSessionCookie("sb-abcdef-auth-token=xyz")).toBe(true);
    expect(hasSupabaseSessionCookie("theme=dark; sb-abcdef-auth-token.0=xyz")).toBe(true);
  });
});

describe("publicHealth — liveness only", () => {
  it("keeps ok/db and drops every configuration fact", () => {
    const full = {
      ok: true,
      db: "up" as const,
      migrations: { total: 44, applied: 41, latest: "0044.sql", missing: ["0042.sql"] },
      auth_methods: ["password"],
      providers: { openai: true, anthropic: false },
      email: { resend_api_key: false, email_from: false },
      budget: { daily_spend_cap_usd: 20, brand_limit: 5 },
    };
    expect(publicHealth(full)).toEqual({ ok: true, db: "up" });
    expect(Object.keys(publicHealth(full))).toEqual(["ok", "db"]);
  });
});

describe("GET /api/health", () => {
  const call = (cookie?: string) =>
    GET(new Request("https://app.example.com/api/health", cookie ? { headers: { cookie } } : undefined));

  it("tells an anonymous caller only that it is alive", async () => {
    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, db: "up" });
    for (const k of CONFIG_KEYS) expect(body).not.toHaveProperty(k);
  });

  it("tells a signed-in NON-admin the same minimal thing", async () => {
    user = { id: "u1" };
    role = "user";

    const body = await (await call("sb-x-auth-token=abc")).json();

    expect(body).toEqual({ ok: true, db: "up" });
    for (const k of CONFIG_KEYS) expect(body).not.toHaveProperty(k);
  });

  it("gives a signed-in admin the full operator payload", async () => {
    user = { id: "u1" };
    role = "admin";

    const body = await (await call("sb-x-auth-token=abc")).json();

    expect(body.ok).toBe(true);
    expect(body).toHaveProperty("migrations");
    expect(body).toHaveProperty("auth_methods");
    expect(body).toHaveProperty("budget");
  });
});
