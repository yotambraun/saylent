// `preflightDomain` is an EXPORTED server action, i.e. a public
// POST endpoint, that makes an outbound fetch to a host the caller names. It had
// auth and SSRF filtering but no rate limit and no demo guard: one signed-up
// account (or one demo visitor, who is auto-signed-in as the shared demo user by
// src/proxy.ts) could drive unlimited outbound requests from our IP, one
// attacker-chosen host per call.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetched: string[] = [];
const limiterCalls: { bucket: string; identifier: string }[] = [];
let user: { id: string; email: string } | null = { id: "user-1", email: "a@b.c" };
let limiterAllows = true;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { preflight: { bucket: "preflight", limit: 20, windowSeconds: 60 } },
  checkRateLimit: async (rule: { bucket: string }, identifier: string) => {
    limiterCalls.push({ bucket: rule.bucket, identifier });
    return limiterAllows;
  },
}));

vi.mock("@saylent/engine/util", () => ({
  safeFetch: async (url: string) => {
    fetched.push(url);
    return { status: 200 };
  },
}));

const { preflightDomain } = await import("./actions");

beforeEach(() => {
  fetched.length = 0;
  limiterCalls.length = 0;
  user = { id: "user-1", email: "a@b.c" };
  limiterAllows = true;
  delete process.env.NEXT_PUBLIC_DEMO_READONLY;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_DEMO_READONLY;
});

describe("preflightDomain — rate limited and demo-guarded (#17)", () => {
  it("takes a per-user token and then fetches", async () => {
    expect(await preflightDomain("example.com")).toEqual({ reachable: true });

    expect(limiterCalls).toEqual([{ bucket: "preflight", identifier: "user-1" }]);
    expect(fetched).toHaveLength(1);
  });

  it("makes NO outbound request once the window is used up", async () => {
    limiterAllows = false;

    expect(await preflightDomain("example.com")).toEqual({ reachable: false });

    expect(limiterCalls).toHaveLength(1);
    expect(fetched).toEqual([]);
  });

  it("makes NO outbound request on the hosted read-only demo", async () => {
    process.env.NEXT_PUBLIC_DEMO_READONLY = "1";

    expect(await preflightDomain("example.com")).toEqual({ reachable: false });

    // refused before auth, before the limiter, before the network
    expect(limiterCalls).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it("still refuses an anonymous caller before anything else", async () => {
    user = null;

    expect(await preflightDomain("example.com")).toEqual({ reachable: false });

    expect(limiterCalls).toEqual([]);
    expect(fetched).toEqual([]);
  });
});
