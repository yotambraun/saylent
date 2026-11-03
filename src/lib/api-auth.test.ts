import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("./supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("./supabase/server", () => ({ createClient: async () => ({}) }));

import { bearerToken, hashApiToken, newApiToken, resolveApiCaller, type ApiAuthDeps } from "./api-auth";

const service = { name: "service" } as unknown as SupabaseClient;
const session = { name: "session" } as unknown as SupabaseClient;

function deps(over: Partial<ApiAuthDeps> = {}): ApiAuthDeps {
  return {
    resolveToken: async () => null,
    sessionUser: async () => null,
    serviceClient: () => service,
    rateLimit: async () => true,
    ...over,
  };
}

const req = (auth?: string) => new Request("https://app.example/api/v1/brands", { headers: auth ? { authorization: auth } : {} });

describe("API tokens", () => {
  it("mints slt_ tokens whose hash is SHA-256 hex and whose prefix is short", () => {
    const t = newApiToken();
    expect(t.token).toMatch(/^slt_[A-Za-z0-9_-]{43}$/);
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.hash).toBe(hashApiToken(t.token));
    expect(t.token.startsWith(t.prefix)).toBe(true);
    expect(t.prefix.length).toBeLessThanOrEqual(16);
    expect(newApiToken().token).not.toBe(t.token);
  });

  it("reads a bearer header", () => {
    expect(bearerToken(req("Bearer slt_abc"))).toBe("slt_abc");
    expect(bearerToken(req("Basic x"))).toBeNull();
  });
});

describe("resolveApiCaller", () => {
  it("resolves a token by its hash to the owner and the service client", async () => {
    const { token, hash } = newApiToken();
    const seen: string[] = [];
    const r = await resolveApiCaller(req(`Bearer ${token}`), deps({ resolveToken: async (h) => (seen.push(h), "user-1") }));
    expect(r).toMatchObject({ ok: true, userId: "user-1", via: "token" });
    expect(r.ok && r.client).toBe(service);
    expect(seen).toEqual([hash]);
  });

  it("refuses a malformed, unknown or revoked token with 401 and never falls back to the session", async () => {
    const sessionUser = vi.fn(async () => ({ id: "user-2", client: session }));
    expect(await resolveApiCaller(req("Bearer nope"), deps({ sessionUser }))).toMatchObject({ ok: false, status: 401 });
    expect(await resolveApiCaller(req(`Bearer ${newApiToken().token}`), deps({ sessionUser }))).toMatchObject({ ok: false, status: 401 });
    expect(sessionUser).not.toHaveBeenCalled();
  });

  it("answers 503, not a crash, when the token lookup itself fails", async () => {
    const r = await resolveApiCaller(req(`Bearer ${newApiToken().token}`), deps({ resolveToken: async () => { throw new Error("supabaseKey is required"); } }));
    expect(r).toMatchObject({ ok: false, status: 503 });
  });

  it("uses the session's own RLS client without a header, and 401s without either", async () => {
    const r = await resolveApiCaller(req(), deps({ sessionUser: async () => ({ id: "user-2", client: session }) }));
    expect(r).toMatchObject({ ok: true, userId: "user-2", via: "session" });
    expect(r.ok && r.client).toBe(session);
    expect(await resolveApiCaller(req(), deps())).toMatchObject({ ok: false, status: 401 });
  });

  it("rate limits per user with Retry-After", async () => {
    const limited = vi.fn(async () => false);
    const r = await resolveApiCaller(req(), deps({ sessionUser: async () => ({ id: "user-3", client: session }), rateLimit: limited }));
    expect(r).toMatchObject({ ok: false, status: 429, retryAfter: 60 });
    expect(limited).toHaveBeenCalledWith("user-3");
  });
});
