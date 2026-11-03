// The SerpApi "Test" button: the free Account API, never a search, and nothing
// from its response but validity and the searches left (the body echoes the key
// and the account email). fetch is injected, so no network is touched.
import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase/admin", () => ({ createAdminClient: () => ({ rpc: async () => ({ data: null, error: null }) }) }));

import { SERPAPI_ACCOUNT_URL, testSerpApiKey } from "./provider-check";

const KEY = "serp_0123456789abcdef";

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("testSerpApiKey", () => {
  it("calls the free Account API with the key, and reports the searches left only", async () => {
    const f = fakeFetch(200, {
      api_key: KEY,
      account_email: "owner@example.com",
      plan_searches_left: 240,
      total_searches_left: 245,
    });
    const res = await testSerpApiKey(KEY, f);
    expect(res).toEqual({ ok: true, detail: "valid, 245 searches left" });
    const url = String((f as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]);
    expect(url.startsWith(`${SERPAPI_ACCOUNT_URL}?api_key=`)).toBe(true);
    expect(JSON.stringify(res)).not.toContain("owner@example.com");
    expect(JSON.stringify(res)).not.toContain(KEY);
  });

  it("names the HTTP status of a refused key", async () => {
    expect(await testSerpApiKey(KEY, fakeFetch(401, { error: "Invalid API key." }))).toEqual({
      ok: false,
      detail: "HTTP 401",
    });
  });

  it("treats an error body as a refusal even on HTTP 200", async () => {
    expect(await testSerpApiKey(KEY, fakeFetch(200, { error: "Invalid API key." }))).toEqual({
      ok: false,
      detail: "rejected by SerpApi",
    });
  });

  it("redacts the key from a network error that echoes the URL", async () => {
    const f = vi.fn(async (url: string) => {
      throw new Error(`fetch failed for ${url}`);
    }) as unknown as typeof fetch;
    const res = await testSerpApiKey(KEY, f);
    expect(res.ok).toBe(false);
    expect(res.detail).not.toContain(KEY);
    expect(res.detail).toContain("[redacted]");
  });
});
