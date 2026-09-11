// keys test — free-call verification with zero real network traffic (fetch
// is injected). Also proves the Gemini check (key travels in the URL) never
// leaks the raw key back out through a thrown error's message.
import { describe, expect, it } from "vitest";
import { testProviderKey } from "./key-test";

function fakeFetch(status: number) {
  return async () => new Response(null, { status }) as unknown as ReturnType<typeof fetch>;
}

describe("testProviderKey", () => {
  it("openai: sends a Bearer header and reports ok on 200", async () => {
    let sawAuth = "";
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      sawAuth = (init?.headers as Record<string, string>)?.authorization ?? "";
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const result = await testProviderKey("openai", "sk-test-123456", fetchImpl);
    expect(result.ok).toBe(true);
    expect(sawAuth).toBe("Bearer sk-test-123456");
  });

  it("anthropic: reports not-ok on a 401", async () => {
    const result = await testProviderKey("anthropic", "sk-ant-bad", fakeFetch(401));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("401");
  });

  it("gemini: builds the key into the URL query string", async () => {
    let sawUrl = "";
    const fetchImpl = (async (url: unknown) => {
      sawUrl = String(url);
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const result = await testProviderKey("gemini", "AIza-secret-key", fetchImpl);
    expect(result.ok).toBe(true);
    expect(sawUrl).toContain("key=AIza-secret-key");
  });

  it("gemini: a thrown fetch error never leaks the raw key even if the error message echoes the URL", async () => {
    const key = "AIza-super-secret-leak-me-not";
    const fetchImpl = (async (url: unknown) => {
      throw new Error(`network error fetching ${String(url)}`);
    }) as typeof fetch;
    const result = await testProviderKey("gemini", key, fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.detail).not.toContain(key);
    expect(result.detail).toContain("[redacted]");
  });

  it("perplexity: no network call; validates the pplx- key format", async () => {
    const ok = await testProviderKey("perplexity", "pplx-abcdef1234567890");
    expect(ok.ok).toBeNull();
    expect(ok.detail).toBe("no free check, key format validated");

    const bad = await testProviderKey("perplexity", "not-the-right-shape");
    expect(bad.ok).toBeNull();
    expect(bad.detail).toMatch(/looks wrong/);
  });
});
