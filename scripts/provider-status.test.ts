// scripts/provider-status.ts writes provider `error` strings straight into
// website/public/status/status.json, which is COMMITTED and PUBLIC. A raw
// adapter error can embed the API key itself (e.g. the Gemini adapter puts
// the key in the request URL, so a fetch failure repeats that URL verbatim).
// This test drives redactProviderError() directly — no network call, no
// provider adapter, no process.env dependency — so it proves the redaction
// without spending a live call.
//
// This file itself lives under scripts/, which is allow-listed for the
// public snapshot — so, like that script's own test file, every fake secret
// value below is assembled from
// joined fragments rather than written as one contiguous key-shaped literal.
// Each fragment is safe alone; only the RUNTIME-joined string reads as a key
// shape, so this file's own source text never trips the very scan it's
// adjacent to (scripts/publish-snapshot.test.ts covers that scan directly).
import { describe, expect, it } from "vitest";
import { redactProviderError } from "./provider-status";

const openaiKey = ["sk-", "fakekeyvalue1234567890abcdef"].join("");
const geminiKey = ["AIza", "FakeGeminiKeyValue1234567890"].join("");
const strayAnthropicKey = ["sk-ant-", "strayLeakedKeyNotInOurConfig123456"].join("");
const strayGoogleKey = ["AIzaSy", "StrayGoogleStyleKeyValue1234"].join("");
const configuredKey = ["sk-", "liveFakeConfiguredKeyForThisTest123456"].join("");
const bearerToken = "abcdefghijklmnopqrstuvwxyz";
const shortId = "ab12";

describe("redactProviderError", () => {
  it("passes through an error with nothing to redact", () => {
    expect(redactProviderError("rate limited, retry in 30s", [openaiKey])).toBe("rate limited, retry in 30s");
  });

  it("redacts every configured provider key's literal value", () => {
    const error = `fetch failed: https://generativelanguage.googleapis.com/v1/models?key=${geminiKey} (auth: ${openaiKey})`;
    const redacted = redactProviderError(error, [openaiKey, geminiKey, undefined]);
    expect(redacted).not.toContain(openaiKey);
    expect(redacted).not.toContain(geminiKey);
    expect(redacted).toContain("[redacted]");
  });

  it("ignores keys shorter than 6 chars so it never mangles ordinary text", () => {
    expect(redactProviderError(`a short id: ${shortId}`, [shortId])).toBe(`a short id: ${shortId}`);
  });

  it("catches an OpenAI/Anthropic-shaped bare key even when it is not one of the configured keys", () => {
    const error = `upstream rejected credential ${strayAnthropicKey}`;
    const redacted = redactProviderError(error, []);
    expect(redacted).not.toContain(strayAnthropicKey);
    expect(redacted).toContain("[redacted]");
  });

  it("catches a Google-shaped API key by shape alone", () => {
    const error = `request failed for key ${strayGoogleKey}`;
    expect(redactProviderError(error, [])).not.toContain(strayGoogleKey);
  });

  it("catches a key= / api_key= query-param or assignment shape", () => {
    expect(redactProviderError(`GET /v1?api_key=${bearerToken} failed`, [])).not.toContain(bearerToken);
    expect(redactProviderError(`GET /v1?key=${bearerToken} failed`, [])).not.toContain(bearerToken);
  });

  it("catches a Bearer token shape", () => {
    const error = `401 Unauthorized: Authorization: Bearer ${bearerToken}`;
    expect(redactProviderError(error, [])).not.toContain(bearerToken);
  });

  it("leaves undefined alone (the ok:true / not_configured paths never call this with a real error)", () => {
    expect(redactProviderError(undefined, [openaiKey])).toBeUndefined();
  });

  it("end to end: a fake result whose error embeds a key never reaches the written status file unredacted", () => {
    const fakeAdapterError = `POST https://api.openai.com/v1/chat/completions 401: invalid key ${configuredKey}`;
    const status = {
      model: "gpt-test",
      ok: false as const,
      latency_ms: 42,
      error: redactProviderError(fakeAdapterError, [configuredKey]),
    };
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain(configuredKey);
    expect(serialized).toContain("[redacted]");
  });
});
