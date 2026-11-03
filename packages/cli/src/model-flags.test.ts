// --judge / --judge-family / --model <role>=<model> — the flag layer of the
// model registry. models.ts owns "which family is this
// model id", so this only tests the ARGV -> ModelSelection translation and
// its error messages.
import { describe, expect, it } from "vitest";
import { familyOfModel } from "@saylent/engine";
import { MODEL_ROLES, parseModelFlags } from "./model-flags";

describe("parseModelFlags", () => {
  it("no flags ⇒ an empty selection", () => {
    expect(parseModelFlags({}, familyOfModel)).toEqual({});
  });

  it("--judge <model> infers the family from the model name", () => {
    expect(parseModelFlags({ judge: "claude-haiku-5-5" }, familyOfModel)).toEqual({
      judge: { anthropic: "claude-haiku-5-5" },
    });
    expect(parseModelFlags({ judge: "gpt-6.1-sol" }, familyOfModel)).toEqual({
      judge: { openai: "gpt-6.1-sol" },
    });
  });

  it("--judge-family overrides the inferred family", () => {
    expect(parseModelFlags({ judge: "gpt-6.1-sol", "judge-family": "anthropic" }, familyOfModel)).toEqual({
      judge: { anthropic: "gpt-6.1-sol" },
    });
  });

  it("an ambiguous --judge model with no --judge-family throws a copy-pasteable error", () => {
    expect(() => parseModelFlags({ judge: "mystery-model" }, familyOfModel)).toThrow(
      /cannot tell which provider[\s\S]*--judge-family anthropic or --judge-family openai/,
    );
  });

  it("an invalid --judge-family value throws", () => {
    expect(() => parseModelFlags({ judge: "gpt-6.1-sol", "judge-family": "bogus" }, familyOfModel)).toThrow(
      /expected "anthropic" or "openai"/,
    );
  });

  it("--judge-family with no --judge throws (it only means something together)", () => {
    expect(() => parseModelFlags({ "judge-family": "anthropic" }, familyOfModel)).toThrow(
      /only means something together with --judge/,
    );
  });

  it("--model brand=<id> / drafter=<id> set the role directly", () => {
    expect(
      parseModelFlags({ model: ["brand=claude-haiku-5-5", "drafter=claude-sonnet-5-5"] }, familyOfModel),
    ).toEqual({ brand: "claude-haiku-5-5", drafter: "claude-sonnet-5-5" });
  });

  it("--model chatgpt=<id> etc. set the engines sub-object, repeatable", () => {
    expect(
      parseModelFlags({ model: ["chatgpt=gpt-6.1-sol-mini", "claude=claude-opus-4"] }, familyOfModel),
    ).toEqual({ engines: { chatgpt: "gpt-6.1-sol-mini", claude: "claude-opus-4" } });
  });

  it("--model with an unknown role throws, naming the valid roles", () => {
    expect(() => parseModelFlags({ model: ["nope=x"] }, familyOfModel)).toThrow(
      new RegExp(`unknown role "nope"\\. Roles: ${MODEL_ROLES.join(", ")}`),
    );
  });

  it("--model with no '=' throws", () => {
    expect(() => parseModelFlags({ model: ["brand"] }, familyOfModel)).toThrow(/expected <role>=<model>/);
  });

  it("--model with an empty model id throws", () => {
    expect(() => parseModelFlags({ model: ["brand="] }, familyOfModel)).toThrow(/the model id is empty/);
  });

  it("combines --judge and multiple --model flags into one selection", () => {
    expect(
      parseModelFlags(
        { judge: "claude-haiku-5-5", model: ["brand=claude-opus-4", "gemini=gemini-3.6-flash"] },
        familyOfModel,
      ),
    ).toEqual({
      judge: { anthropic: "claude-haiku-5-5" },
      brand: "claude-opus-4",
      engines: { gemini: "gemini-3.6-flash" },
    });
  });
});
