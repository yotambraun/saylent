// The precedence rules the console rests on:
//   keys   env > console (encrypted) > absent
//   models env MODEL_* > console > shipped default
// plus the two safety invariants: the masked view can never contain key material,
// and a key stored through the console round-trips through the encrypting RPC.
//
// The Supabase service client is mocked with a tiny fake that behaves like the
// migration-0042 RPCs (encrypt on set, decrypt on get, presence without a secret),
// so the precedence logic is tested without a database and without ever holding a
// real key.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── the fake DB (stands in for migration 0042) ──────────────────────────────
const store = {
  keys: new Map<string, string>(), // provider -> "cipher:<secret>:<key>"
  overrides: {} as Record<string, string>,
  calls: [] as { fn: string; args: Record<string, unknown> }[],
};

function encrypt(key: string, secret: string) {
  return `cipher:${secret}:${key}`;
}
function decrypt(cipher: string, secret: string) {
  const prefix = `cipher:${secret}:`;
  if (!cipher.startsWith(prefix)) throw new Error("Wrong key or corrupt data");
  return cipher.slice(prefix.length);
}

vi.mock("./supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      store.calls.push({ fn, args });
      try {
        if (fn === "get_provider_keys") {
          const out: Record<string, string> = {};
          for (const [provider, cipher] of store.keys) {
            out[provider] = decrypt(cipher, String(args.p_secret));
          }
          return { data: out, error: null };
        }
        if (fn === "provider_settings_state") {
          return {
            data: {
              stored_providers: [...store.keys.keys()].sort(),
              model_overrides: { ...store.overrides },
            },
            error: null,
          };
        }
        if (fn === "set_provider_key") {
          store.keys.set(
            String(args.p_provider),
            encrypt(String(args.p_key), String(args.p_secret)),
          );
          return { data: null, error: null };
        }
        if (fn === "remove_provider_key") {
          store.keys.delete(String(args.p_provider));
          return { data: null, error: null };
        }
        if (fn === "set_model_overrides") {
          store.overrides = { ...(args.p_overrides as Record<string, string>) };
          return { data: null, error: null };
        }
        return { data: null, error: { message: `unexpected rpc ${fn}` } };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
  }),
}));

import {
  consoleOnlyProviders,
  DISPLAY_BY_SOURCE,
  getEffectiveModelOverrides,
  getEffectiveProviderKeys,
  getKeySources,
  masked,
  maskedProviders,
  modelChoiceRows,
  removeProviderKey,
  saveModelOverrides,
  setProviderKey,
} from "./provider-settings";

const SECRET = "0123456789abcdef0123456789abcdef";
const ENV_KEYS = [
  "APP_SECRET",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "PERPLEXITY_API_KEY",
  "MODEL_JUDGE_ANTHROPIC",
  "MODEL_DRAFTER",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  store.keys.clear();
  store.overrides = {};
  store.calls = [];
  process.env.APP_SECRET = SECRET;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("provider keys — precedence", () => {
  it("env wins over a console-stored key", async () => {
    await setProviderKey("admin-1", "openai", "sk-console");
    process.env.OPENAI_API_KEY = "sk-env";
    expect((await getEffectiveProviderKeys()).openai).toBe("sk-env");
    expect((await getKeySources()).openai).toBe("env");
  });

  it("falls back to the console key when the env var is unset", async () => {
    await setProviderKey("admin-1", "anthropic", "sk-ant-console");
    expect((await getEffectiveProviderKeys()).anthropic).toBe("sk-ant-console");
    expect((await getKeySources()).anthropic).toBe("console");
  });

  it("absent when neither layer has one", async () => {
    expect((await getEffectiveProviderKeys()).gemini).toBeUndefined();
    expect((await getKeySources()).gemini).toBe("absent");
  });

  it("removing a console key returns the provider to absent", async () => {
    await setProviderKey("admin-1", "perplexity", "pplx-1");
    expect((await getKeySources()).perplexity).toBe("console");
    await removeProviderKey("admin-1", "perplexity");
    expect((await getKeySources()).perplexity).toBe("absent");
    expect((await getEffectiveProviderKeys()).perplexity).toBeUndefined();
  });
});

describe("encryption round trip", () => {
  it("stores ciphertext and reads the key back through the RPC", async () => {
    const res = await setProviderKey("admin-1", "openai", "  sk-secret-value  ");
    expect(res.ok).toBe(true);
    // what the DB holds is not the key
    expect(store.keys.get("openai")).not.toBe("sk-secret-value");
    expect(store.keys.get("openai")).toContain("cipher:");
    // the secret is passed per call, never persisted alongside the ciphertext
    const setCall = store.calls.find((c) => c.fn === "set_provider_key");
    expect(setCall?.args.p_secret).toBe(SECRET);
    expect(setCall?.args.p_actor).toBe("admin-1");
    expect(await getEffectiveProviderKeys()).toEqual({ openai: "sk-secret-value" });
  });

  it("a wrong APP_SECRET degrades to env-only instead of throwing", async () => {
    await setProviderKey("admin-1", "openai", "sk-secret-value");
    process.env["APP_SECRET"] = "ff".repeat(16);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await getEffectiveProviderKeys()).toEqual({});
    warn.mockRestore();
  });

  it("refuses to store a key without a usable APP_SECRET", async () => {
    delete process.env.APP_SECRET;
    const res = await setProviderKey("admin-1", "openai", "sk-1");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Set APP_SECRET to manage keys here.");
    expect(store.keys.size).toBe(0);
  });

  it("refuses to overwrite an env-set key from the console", async () => {
    process.env.GEMINI_API_KEY = "env-key";
    const res = await setProviderKey("admin-1", "gemini", "console-key");
    expect(res.ok).toBe(false);
    expect(store.keys.size).toBe(0);
  });
});

describe("masked view", () => {
  it("prints three fixed strings and never key material", async () => {
    await setProviderKey("admin-1", "anthropic", "sk-ant-super-secret");
    process.env.OPENAI_API_KEY = "sk-env-super-secret";
    const rows = await maskedProviders();
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("sk-ant-super-secret");
    expect(serialized).not.toContain("sk-env-super-secret");
    expect(serialized).not.toContain("cipher:");
    for (const row of rows) {
      expect(Object.values(DISPLAY_BY_SOURCE)).toContain(row.display);
    }
    expect(rows.find((r) => r.provider === "openai")?.display).toBe("present (env)");
    expect(rows.find((r) => r.provider === "anthropic")?.display).toBe("present (console)");
    expect(rows.find((r) => r.provider === "gemini")?.display).toBe("absent");
  });

  it("marks env-set and secret-less providers as not editable", () => {
    const rows = masked(
      { openai: "env", anthropic: "console", gemini: "absent", perplexity: "absent" },
      true,
    );
    expect(rows.find((r) => r.provider === "openai")?.editable).toBe(false);
    expect(rows.find((r) => r.provider === "anthropic")?.editable).toBe(true);

    const noSecret = masked(
      { openai: "absent", anthropic: "absent", gemini: "absent", perplexity: "absent" },
      false,
    );
    expect(noSecret.every((r) => !r.editable)).toBe(true);
  });
});

describe("model overrides — precedence", () => {
  it("console overrides the shipped default", async () => {
    await saveModelOverrides("admin-1", { judgeAnthropic: "claude-test-judge" }, "pinning a judge");
    const rows = await modelChoiceRows();
    const judge = rows.find((r) => r.role === "judgeAnthropic");
    expect(judge?.model).toBe("claude-test-judge");
    expect(judge?.source).toBe("console");
    // untouched roles stay on the registry default
    expect(rows.find((r) => r.role === "drafter")?.source).toBe("default");
  });

  it("env MODEL_* beats the console", async () => {
    await saveModelOverrides("admin-1", { judgeAnthropic: "claude-console" }, "why");
    process.env.MODEL_JUDGE_ANTHROPIC = "claude-env";
    const judge = (await modelChoiceRows()).find((r) => r.role === "judgeAnthropic");
    expect(judge?.model).toBe("claude-env");
    expect(judge?.source).toBe("env");
    // and the effective map drops the shadowed role entirely
    expect(await getEffectiveModelOverrides()).toEqual({});
  });

  it("an empty map is 'reset to defaults'", async () => {
    await saveModelOverrides("admin-1", { drafter: "x" }, "try");
    await saveModelOverrides("admin-1", {}, "reset");
    expect(await getEffectiveModelOverrides()).toEqual({});
    expect((await modelChoiceRows()).every((r) => r.source === "default")).toBe(true);
  });

  it("requires a reason and rejects an unknown role", async () => {
    expect((await saveModelOverrides("admin-1", { drafter: "x" }, "  ")).ok).toBe(false);
    const bad = await saveModelOverrides(
      "admin-1",
      { nope: "x" } as unknown as Record<string, string>,
      "r",
    );
    expect(bad.ok).toBe(false);
  });
});

// A console key must never be published into process.env.
// The old applyProviderKeysToEnv() did exactly that, and the consequence was
// that the key could not be revoked: the next resolution saw it as an "env" key,
// env-wins pinned it, and deleting it in the console changed nothing until the
// instance was recycled. These tests are that reproduction, inverted.
describe("no key is ever written to the process environment (#6)", () => {
  it("does not export applyProviderKeysToEnv any more", async () => {
    const mod = await import("./provider-settings");
    expect("applyProviderKeysToEnv" in mod).toBe(false);
  });

  it("resolving a console key leaves process.env untouched", async () => {
    process.env.APP_SECRET = SECRET;
    delete process.env.OPENAI_API_KEY;
    await setProviderKey("admin-1", "openai", "sk-console");

    expect(await getEffectiveProviderKeys()).toMatchObject({ openai: "sk-console" });
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
  });

  it("a revoked console key is gone on the very next resolution", async () => {
    process.env.APP_SECRET = SECRET;
    delete process.env.OPENAI_API_KEY;
    await setProviderKey("admin-1", "openai", "sk-console");
    expect((await getEffectiveProviderKeys()).openai).toBe("sk-console");

    await removeProviderKey("admin-1", "openai");
    // env was never polluted, so nothing pins the revoked value
    expect((await getEffectiveProviderKeys()).openai).toBeUndefined();
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    expect((await getKeySources()).openai).toBe("absent");
  });

  it("env still wins over the console (the rule is a read, not a write)", async () => {
    process.env.APP_SECRET = SECRET;
    await setProviderKey("admin-1", "anthropic", "sk-console");
    process.env.ANTHROPIC_API_KEY = "sk-env";

    expect((await getEffectiveProviderKeys()).anthropic).toBe("sk-env");
    expect((await getKeySources()).anthropic).toBe("env");
  });
});

describe("consoleOnlyProviders — what the env-reading judgment layer cannot see", () => {
  it("names the providers whose key exists only in the console", () => {
    const env = { OPENAI_API_KEY: "env-wins" } as unknown as NodeJS.ProcessEnv;
    expect(
      consoleOnlyProviders({ openai: "env-wins", anthropic: "console-ant" }, env),
    ).toEqual(["anthropic"]);
  });

  it("is empty when every key came from the environment", () => {
    const env = { OPENAI_API_KEY: "a", ANTHROPIC_API_KEY: "b" } as unknown as NodeJS.ProcessEnv;
    expect(consoleOnlyProviders({ openai: "a", anthropic: "b" }, env)).toEqual([]);
  });
});
