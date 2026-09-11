// SINGLE-PROVIDER MODE: the role-resolution table.
// One provider key must run a full audit — that family serves the brand model,
// the drafter and every judge — while two keys keep today's cross-family judging
// byte-for-byte. MODEL_* env overrides win in every mode.
import { afterEach, describe, expect, it } from "vitest";
import {
  CROSS_FAMILY_JUDGE,
  familyOfModel,
  injectedModelOverrides,
  injectModelOverrides,
  judgeFamilies,
  resolveModelTable,
  resolveRoles,
  rolesForBundle,
} from "./models";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "MODEL_JUDGE_OPENAI",
  "MODEL_JUDGE_ANTHROPIC",
  "MODEL_BRAND",
  "MODEL_BRAND_OPENAI",
  "MODEL_DRAFTER_OPENAI",
  "MODEL_CHATGPT_ANSWER",
] as const;

const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("resolveRoles", () => {
  it("both keys: cross-family judging, brand + drafter on Anthropic (unchanged)", () => {
    const roles = resolveRoles({ openai: true, anthropic: true });
    expect(roles.judgeMode).toBe("cross-family");
    expect(roles.families).toEqual(["anthropic", "openai"]);
    expect(judgeFamilies(roles)).toEqual(CROSS_FAMILY_JUDGE);
    expect(roles.roles.brand).toEqual({ family: "anthropic", model: "claude-haiku-4-5" });
    expect(roles.roles.drafter).toEqual({ family: "anthropic", model: "claude-sonnet-4-6" });
    expect(roles.roles["judge:for-chatgpt"]).toEqual({
      family: "anthropic",
      model: "claude-haiku-4-5",
    });
    expect(roles.roles["judge:for-claude"]).toEqual({ family: "openai", model: "gpt-5-mini" });
    expect(roles.selfJudged).toEqual([]);
  });

  it("OpenAI only: every role on OpenAI, judge_mode single-family", () => {
    const roles = resolveRoles({ openai: true });
    expect(roles.judgeMode).toBe("single-family");
    expect(roles.families).toEqual(["openai"]);
    expect(judgeFamilies(roles)).toEqual({
      chatgpt: "openai",
      claude: "openai",
      gemini: "openai",
      perplexity: "openai",
    });
    expect(roles.roles.brand).toEqual({ family: "openai", model: "gpt-5-mini" });
    expect(roles.roles.drafter).toEqual({ family: "openai", model: "gpt-5.4" });
    // the chatgpt ANSWER model (gpt-5.4) is never the model that judges it
    expect(roles.roles["judge:for-chatgpt"].model).toBe("gpt-5-mini");
    expect(roles.selfJudged).toEqual([]);
  });

  it("Anthropic only: every role on Anthropic, judge_mode single-family", () => {
    const roles = resolveRoles({ anthropic: true });
    expect(roles.judgeMode).toBe("single-family");
    expect(roles.families).toEqual(["anthropic"]);
    expect(judgeFamilies(roles)).toEqual({
      chatgpt: "anthropic",
      claude: "anthropic",
      gemini: "anthropic",
      perplexity: "anthropic",
    });
    expect(roles.roles.brand.family).toBe("anthropic");
    expect(roles.roles.drafter.family).toBe("anthropic");
    // the claude ANSWER model (sonnet) is judged by the dedicated judge (haiku)
    expect(roles.roles["judge:for-claude"].model).toBe("claude-haiku-4-5");
    expect(roles.selfJudged).toEqual([]);
  });

  it("no key at all: the historical cross-family map (every caller degrades to null)", () => {
    const roles = resolveRoles({});
    expect(roles.judgeMode).toBe("cross-family");
    expect(roles.families).toEqual([]);
    expect(judgeFamilies(roles)).toEqual(CROSS_FAMILY_JUDGE);
  });

  it("MODEL_* overrides win in single-family mode too", () => {
    process.env.MODEL_JUDGE_OPENAI = "gpt-test-judge";
    process.env.MODEL_BRAND_OPENAI = "gpt-test-brand";
    process.env.MODEL_DRAFTER_OPENAI = "gpt-test-drafter";
    const roles = resolveRoles({ openai: true });
    expect(roles.roles.brand.model).toBe("gpt-test-brand");
    expect(roles.roles.drafter.model).toBe("gpt-test-drafter");
    expect(roles.roles["judge:for-gemini"].model).toBe("gpt-test-judge");
  });

  it("flags an engine whose judge model was overridden onto its own answer model", () => {
    process.env.MODEL_JUDGE_OPENAI = "gpt-5.4"; // == the default chatgpt answer model
    const roles = resolveRoles({ openai: true });
    expect(roles.selfJudged).toEqual(["chatgpt"]);
  });

  it("reads the keys from the environment when none are passed", () => {
    delete process.env.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(resolveRoles().judgeMode).toBe("single-family");
    process.env.OPENAI_API_KEY = "sk-test";
    expect(resolveRoles().judgeMode).toBe("cross-family");
  });

  it("rolesForBundle is a flat, JSON-friendly copy of the role map", () => {
    const roles = resolveRoles({ anthropic: true });
    const flat = rolesForBundle(roles);
    expect(flat.brand).toEqual(roles.roles.brand);
    expect(Object.keys(flat).sort()).toEqual([
      "brand",
      "drafter",
      "judge:for-chatgpt",
      "judge:for-claude",
      "judge:for-gemini",
      "judge:for-perplexity",
    ]);
    expect(JSON.parse(JSON.stringify(flat))).toEqual(flat);
  });
});

describe("familyOfModel", () => {
  it("recognizes anthropic and openai model ids, and region-prefixed ids", () => {
    expect(familyOfModel("claude-sonnet-4-6")).toBe("anthropic");
    expect(familyOfModel("us.anthropic.claude-haiku-4-5")).toBe("anthropic");
    expect(familyOfModel("gpt-5.4")).toBe("openai");
    expect(familyOfModel("o3-mini")).toBe("openai");
    expect(familyOfModel("chatgpt-4o")).toBe("openai");
  });

  it("returns null for a name it cannot classify", () => {
    expect(familyOfModel("gemini-3.6-flash")).toBeNull();
    expect(familyOfModel("mystery-model")).toBeNull();
  });
});

describe("resolveModelTable precedence: flag > MODEL_* env > saylent.config models > shipped default", () => {
  it("no inputs ⇒ every slot resolves to its shipped default, source 'default'", () => {
    const table = resolveModelTable({ env: {} as NodeJS.ProcessEnv });
    expect(table.judgeAnthropic).toEqual({
      model: "claude-haiku-4-5",
      source: "default",
      envVar: "MODEL_JUDGE_ANTHROPIC",
      label: "judge (anthropic)",
    });
  });

  it("saylent.config models overrides the default", () => {
    const table = resolveModelTable({
      env: {} as unknown as NodeJS.ProcessEnv,
      config: { judge: { anthropic: "claude-config-judge" } },
    });
    expect(table.judgeAnthropic.model).toBe("claude-config-judge");
    expect(table.judgeAnthropic.source).toBe("config");
  });

  it("MODEL_* env beats saylent.config", () => {
    const table = resolveModelTable({
      env: { MODEL_JUDGE_ANTHROPIC: "claude-env-judge" } as unknown as NodeJS.ProcessEnv,
      config: { judge: { anthropic: "claude-config-judge" } },
    });
    expect(table.judgeAnthropic.model).toBe("claude-env-judge");
    expect(table.judgeAnthropic.source).toBe("env");
  });

  it("a CLI flag beats env and config both", () => {
    const table = resolveModelTable({
      env: { MODEL_JUDGE_ANTHROPIC: "claude-env-judge" } as unknown as NodeJS.ProcessEnv,
      config: { judge: { anthropic: "claude-config-judge" } },
      flags: { judge: { anthropic: "claude-flag-judge" } },
    });
    expect(table.judgeAnthropic.model).toBe("claude-flag-judge");
    expect(table.judgeAnthropic.source).toBe("flag");
  });

  it("an empty-string env value counts as unset (falls through to config)", () => {
    const table = resolveModelTable({
      env: { MODEL_JUDGE_ANTHROPIC: "  " } as unknown as NodeJS.ProcessEnv,
      config: { judge: { anthropic: "claude-config-judge" } },
    });
    expect(table.judgeAnthropic.source).toBe("config");
  });

  it("resolveRoles honors flags/config inputs the same way, per role", () => {
    const roles = resolveRoles(
      { anthropic: true },
      { config: { brand: "claude-config-brand" }, flags: { drafter: "claude-flag-drafter" } },
    );
    expect(roles.roles.brand.model).toBe("claude-config-brand");
    expect(roles.roles.drafter.model).toBe("claude-flag-drafter");
  });
});

// The "console" layer: per-role overrides injected by
// the self-hosted app's admin console. Sits BELOW env (a deploy-time MODEL_* is the
// owner's explicit instruction and always wins) and ABOVE saylent.config. The CLI
// never injects, so nothing above changes for it.
describe("console overrides", () => {
  afterEach(() => injectModelOverrides(null));

  it("beats the shipped default", () => {
    const table = resolveModelTable({ env: {} as NodeJS.ProcessEnv, overrides: { drafter: "console-drafter" } });
    expect(table.drafter.model).toBe("console-drafter");
    expect(table.drafter.source).toBe("console");
  });

  it("loses to the MODEL_* env var", () => {
    const table = resolveModelTable({
      env: { MODEL_DRAFTER: "env-drafter" } as unknown as NodeJS.ProcessEnv,
      overrides: { drafter: "console-drafter" },
    });
    expect(table.drafter.model).toBe("env-drafter");
    expect(table.drafter.source).toBe("env");
  });

  it("beats saylent.config, and a flag still beats it", () => {
    const base = { env: {} as NodeJS.ProcessEnv, config: { drafter: "config-drafter" } };
    expect(resolveModelTable({ ...base, overrides: { drafter: "console-drafter" } }).drafter.source).toBe("console");
    expect(
      resolveModelTable({ ...base, overrides: { drafter: "console-drafter" }, flags: { drafter: "flag-drafter" } })
        .drafter.source,
    ).toBe("flag");
  });

  it("resolveRoles applies them per role", () => {
    const roles = resolveRoles({ anthropic: true }, { overrides: { judgeAnthropic: "console-judge" } });
    expect(roles.roles["judge:for-chatgpt"].model).toBe("console-judge");
  });

  it("an injected map reaches callers that resolve with no inputs (llm.ts/judge.ts)", () => {
    const noEnv = { env: {} as NodeJS.ProcessEnv };
    expect(resolveModelTable(noEnv).drafter.source).not.toBe("console");
    injectModelOverrides({ drafter: "ambient-drafter" });
    expect(injectedModelOverrides()).toEqual({ drafter: "ambient-drafter" });
    expect(resolveModelTable(noEnv).drafter.model).toBe("ambient-drafter");
    // an explicit map on the call wins over the ambient one
    expect(resolveModelTable({ ...noEnv, overrides: {} }).drafter.source).not.toBe("console");
    injectModelOverrides(null);
    expect(injectedModelOverrides()).toBeNull();
    expect(resolveModelTable(noEnv).drafter.source).not.toBe("console");
  });
});
