// Tests for mapProviderError, the per-(provider, kind) plain-sentence map.
import { afterEach, describe, expect, it } from "vitest";
import { mapProviderError, parseAdapterError } from "./errors";
import { clearRegisteredSecrets, registerSecret } from "./redact";

describe("parseAdapterError", () => {
  it("parses the '<kind>: <message>' tag shared.ts writes", () => {
    expect(parseAdapterError("rate_limit: Too Many Requests")).toEqual({
      kind: "rate_limit",
      message: "Too Many Requests",
    });
    expect(parseAdapterError("missing_key: KEY missing")).toEqual({
      kind: "missing_key",
      message: "KEY missing",
    });
  });

  it("falls back to unknown for an unrecognized/legacy shape", () => {
    expect(parseAdapterError("some legacy raw error text")).toEqual({
      kind: "unknown",
      message: "some legacy raw error text",
    });
  });
});

describe("mapProviderError — one plain sentence + one action, per (provider, kind)", () => {
  it("OpenAI 401/403 → key rejected, points at `saylent keys test`", () => {
    const msg = mapProviderError("chatgpt", "auth: Incorrect API key provided");
    expect(msg).toContain("OpenAI key was rejected");
    expect(msg).toContain("saylent keys test");
  });

  it("OpenAI 402/insufficient_quota → billing link + rerun", () => {
    const msg = mapProviderError("chatgpt", "quota: insufficient_quota");
    expect(msg).toContain("no credit");
    expect(msg).toContain("platform.openai.com/settings/billing");
  });

  it("OpenAI 429 → retrying + backoff, suggests --samples/wait", () => {
    const msg = mapProviderError("chatgpt", "rate_limit: 429");
    expect(msg).toContain("rate-limited");
    expect(msg).toContain("--samples");
  });

  it("OpenAI 404/model not found → names the model, points at `saylent models`", () => {
    const msg = mapProviderError("chatgpt", "not_found: model_not_found", "gpt-9000");
    expect(msg).toContain("gpt-9000");
    expect(msg).toContain("saylent models");
    expect(msg).toContain("--model <role>=<model>");
  });

  it("OpenAI 5xx/timeout → 'having trouble', other engines continue", () => {
    const msg = mapProviderError("chatgpt", "server: 503 Service Unavailable");
    expect(msg).toContain("OpenAI is having trouble");
    expect(msg).toContain("other engines continue");
  });

  it("Anthropic mirrors the same taxonomy with its own billing URL", () => {
    expect(mapProviderError("claude", "auth: unauthorized")).toContain("Anthropic key was rejected");
    expect(mapProviderError("claude", "quota: insufficient_quota")).toContain(
      "console.anthropic.com/settings/billing",
    );
  });

  it("Gemini's auth message calls out 'API not enabled', not a bad key", () => {
    const msg = mapProviderError("gemini", "auth: PERMISSION_DENIED");
    expect(msg).toContain("API");
    expect(msg.toLowerCase()).toContain("enabled");
  });

  it("Gemini quota points at aistudio.google.com", () => {
    expect(mapProviderError("gemini", "quota: RESOURCE_EXHAUSTED")).toContain("aistudio.google.com");
  });

  it("Perplexity's rate-limit message calls out a brand-new key", () => {
    const msg = mapProviderError("perplexity", "rate_limit: 429");
    expect(msg.toLowerCase()).toContain("new key");
  });

  it("missing_key names the provider and `saylent keys`", () => {
    expect(mapProviderError("gemini", "missing_key: KEY missing")).toBe(
      "No Gemini key configured. Run `saylent keys` to add one.",
    );
  });

  it("falls back to a generic sentence for an unrecognized raw error", () => {
    const msg = mapProviderError("chatgpt", "some legacy raw error text");
    expect(msg).toContain("OpenAI");
  });
});

// ---------------------------------------------------------------------------
// The "unknown" kind has no per-provider template, so mapProviderError
// falls through to printing the provider's RAW words. That is the one branch
// that can carry a key (Gemini puts it in the URL its transport echoes).
// ---------------------------------------------------------------------------
describe("mapProviderError redacts the raw fallback", () => {
  afterEach(() => clearRegisteredSecrets());

  it("redacts a key this process holds", () => {
    const KEY = "AIzaSyD-progress-fallback-key-0123456789";
    registerSecret(KEY);
    const out = mapProviderError(
      "gemini",
      `unknown: fetch failed https://generativelanguage.googleapis.com/v1beta/x?key=${KEY}`,
    );
    expect(out).not.toContain(KEY);
    expect(out).toContain("[redacted]");
    expect(out.startsWith("Gemini returned an error:")).toBe(true);
  });

  it("redacts a key it does NOT hold, by shape", () => {
    const stray = "sk-" + "proj-neverregistered0123456789abcdef";
    expect(mapProviderError("chatgpt", `unknown: upstream echoed ${stray}`)).not.toContain(stray);
  });

  it("leaves the templated sentences exactly as they were", () => {
    expect(mapProviderError("chatgpt", "auth: whatever")).toBe(
      "Your OpenAI key was rejected. Check it with `saylent keys test`.",
    );
  });
});
