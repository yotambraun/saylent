// --profile / --engines refuse a bad value with a sentence, at every layer
// that can supply one. Before this, `--profile medium` crashed with a raw
// TypeError ("Cannot read properties of undefined (reading 'scoredSamples')")
// and `--engines chatgpt,claud` silently ran a one-engine audit the operator
// paid for believing they had asked for two.
import { describe, expect, it } from "vitest";
import { ENGINE_NAMES, parseEngineList, parseProfileName } from "./validate";

const PROFILES = ["full", "smoke"] as const;

describe("parseProfileName", () => {
  it("passes a valid name through", () => {
    expect(parseProfileName("smoke", PROFILES)).toBe("smoke");
    expect(parseProfileName("full", PROFILES)).toBe("full");
  });

  it("undefined and empty mean 'not set', never an error", () => {
    expect(parseProfileName(undefined, PROFILES)).toBeUndefined();
    expect(parseProfileName("  ", PROFILES)).toBeUndefined();
  });

  it("names the flag AND both valid values — never a TypeError", () => {
    expect(() => parseProfileName("medium", PROFILES)).toThrow(
      '--profile medium: expected "full" or "smoke".',
    );
  });

  it("cites the env var and the config key by their own names", () => {
    expect(() => parseProfileName("medium", PROFILES, "env")).toThrow(
      'AUDIT_PROFILE "medium": expected "full" or "smoke".',
    );
    expect(() => parseProfileName("medium", PROFILES, "config")).toThrow(
      'saylent.config profile "medium": expected "full" or "smoke".',
    );
  });

  it("lists whatever the profile registry actually holds", () => {
    expect(() => parseProfileName("x", ["a", "b", "c"])).toThrow('expected "a", "b" or "c".');
  });
});

describe("parseEngineList", () => {
  it("is the four answer engines, derived from the provider registry", () => {
    expect([...ENGINE_NAMES]).toEqual(["chatgpt", "claude", "gemini", "perplexity"]);
  });

  it("parses and de-duplicates a good list", () => {
    expect(parseEngineList("chatgpt, claude ,chatgpt")).toEqual(["chatgpt", "claude"]);
  });

  it("REFUSES an unknown name instead of dropping it", () => {
    expect(() => parseEngineList("chatgpt,claud")).toThrow(
      '--engines chatgpt,claud: unknown engine "claud". Valid engines: chatgpt, claude, gemini, perplexity.',
    );
  });

  it("corrects a provider name by name — the vocabulary `keys set` taught", () => {
    expect(() => parseEngineList("anthropic")).toThrow(
      '"anthropic" is a provider; the engine is "claude"',
    );
    expect(() => parseEngineList("openai")).toThrow('"openai" is a provider; the engine is "chatgpt"');
    expect(() => parseEngineList("google")).toThrow('"google" is a provider; the engine is "gemini"');
  });

  it("gemini and perplexity name both a provider and an engine, so they pass", () => {
    expect(parseEngineList("gemini,perplexity")).toEqual(["gemini", "perplexity"]);
  });

  it("refuses an empty list rather than silently asking every engine", () => {
    expect(() => parseEngineList(",  ,")).toThrow(/expected a comma-separated list of/);
  });

  it("cites AUDIT_ENGINES and saylent.config engines by name", () => {
    expect(() => parseEngineList("claud", "env")).toThrow(/^AUDIT_ENGINES "claud": unknown engine/);
    expect(() => parseEngineList(["claud"], "config")).toThrow(
      /^saylent\.config engines "claud": unknown engine/,
    );
  });
});
