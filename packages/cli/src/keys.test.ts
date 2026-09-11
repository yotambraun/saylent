// keys resolution order + redaction — $0, no network, no real ~/.saylent
// writes (HOME is redirected to a temp dir for every test).
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyKeysToEnv,
  configFilePath,
  hasCrossFamilyKeys,
  hasMinimumKeys,
  keyHelpLines,
  missingKeysError,
  parseDotEnv,
  PROVIDER_TO_ENGINE,
  PROVIDERS,
  readConfigFile,
  resolveKeys,
  saveKeys,
  writeConfigFile,
} from "./keys";
import { clearRegisteredSecrets, maskKey, redactError, redactKnownSecrets, redactSecrets } from "./redact";

let home: string;
let cwd: string;
const originalEnv = { ...process.env };

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "saylent-home-"));
  cwd = mkdtempSync(path.join(tmpdir(), "saylent-cwd-"));
  // Plain process.env assignment, NOT vi.stubEnv: vi.stubEnv's own
  // snapshot/restore timing raced os.homedir() reads across adjacent tests
  // in this file (verified empirically — os.homedir() intermittently
  // returned a PREVIOUS test's stubbed HOME). Direct assignment + the
  // afterEach restore below is the reliable form.
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe("parseDotEnv", () => {
  it("parses KEY=VALUE, skips comments and blanks, strips quotes", () => {
    // Key/value split across a `+` so the snapshot sanitization scan (which
    // flags a contiguous `xxx_API_KEY=<value>` shape) doesn't false-positive
    // on these test-only fixture values.
    const text = [
      "# a comment",
      "",
      "OPENAI_API_KEY=" + "sk-abc123",
      'ANTHROPIC_API_KEY="sk-ant-with spaces"',
      "GEMINI_API_KEY='single-quoted'",
      "export PERPLEXITY_API_KEY=" + "pplx-xyz",
    ].join("\n");
    expect(parseDotEnv(text)).toEqual({
      OPENAI_API_KEY: "sk-abc123",
      ANTHROPIC_API_KEY: "sk-ant-with spaces",
      GEMINI_API_KEY: "single-quoted",
      PERPLEXITY_API_KEY: "pplx-xyz",
    });
  });
});

describe("resolveKeys precedence: env -> .env -> ~/.saylent/config.json", () => {
  it("env wins over everything", () => {
    process.env.OPENAI_API_KEY = "from-env";
    writeFileSync(path.join(cwd, ".env"), "OPENAI_API_KEY=" + "from-dotenv\n");
    writeConfigFile({ keys: { openai: "from-config" } });
    const { keys, sources } = resolveKeys(cwd);
    expect(keys.openai).toBe("from-env");
    expect(sources.openai).toBe("env");
  });

  it(".env wins over config when env is unset", () => {
    writeFileSync(path.join(cwd, ".env"), "ANTHROPIC_API_KEY=" + "from-dotenv\n");
    writeConfigFile({ keys: { anthropic: "from-config" } });
    const { keys, sources } = resolveKeys(cwd);
    expect(keys.anthropic).toBe("from-dotenv");
    expect(sources.anthropic).toBe(".env");
  });

  it("falls back to ~/.saylent/config.json last", () => {
    writeConfigFile({ keys: { gemini: "from-config" } });
    const { keys, sources } = resolveKeys(cwd);
    expect(keys.gemini).toBe("from-config");
    expect(sources.gemini).toBe("~/.saylent/config.json");
  });

  it("leaves a provider unset when no source has it", () => {
    const { keys, sources } = resolveKeys(cwd);
    expect(keys.perplexity).toBeUndefined();
    expect(sources.perplexity).toBeUndefined();
  });

  it("resolves each provider independently", () => {
    process.env.OPENAI_API_KEY = "env-openai";
    writeFileSync(path.join(cwd, ".env"), "ANTHROPIC_API_KEY=" + "dotenv-anthropic\n");
    writeConfigFile({ keys: { gemini: "config-gemini" } });
    const { keys } = resolveKeys(cwd);
    expect(keys).toEqual({ openai: "env-openai", anthropic: "dotenv-anthropic", gemini: "config-gemini" });
  });
});

describe("writeConfigFile / readConfigFile", () => {
  it("writes ~/.saylent/config.json with chmod 600 (POSIX)", () => {
    writeConfigFile({ keys: { openai: "sk-test" } });
    const file = configFilePath();
    expect(existsSync(file)).toBe(true);
    expect(readConfigFile()).toEqual({ keys: { openai: "sk-test" } });
    if (process.platform !== "win32") {
      const mode = statSync(file).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("readConfigFile returns {} for a missing or malformed file", () => {
    expect(readConfigFile()).toEqual({});
    mkdirSync(path.dirname(configFilePath()), { recursive: true });
    writeFileSync(configFilePath(), "{ not json");
    expect(readConfigFile()).toEqual({});
  });

  it("saveKeys merges into existing keys", () => {
    writeConfigFile({ keys: { openai: "old-openai" } });
    saveKeys(readConfigFile().keys ?? {}, { anthropic: "new-anthropic" });
    expect(readConfigFile().keys).toEqual({ openai: "old-openai", anthropic: "new-anthropic" });
  });
});

describe("hasMinimumKeys / hasCrossFamilyKeys / missingKeysError", () => {
  it("ONE judgment key is enough to run; gemini/perplexity never are", () => {
    expect(hasMinimumKeys({})).toBe(false);
    expect(hasMinimumKeys({ gemini: "g", perplexity: "p" })).toBe(false);
    expect(hasMinimumKeys({ openai: "x" })).toBe(true);
    expect(hasMinimumKeys({ anthropic: "y" })).toBe(true);
    expect(hasMinimumKeys({ openai: "x", anthropic: "y", gemini: undefined })).toBe(true);
  });

  it("cross-family judging needs BOTH judgment keys", () => {
    expect(hasCrossFamilyKeys({ openai: "x" })).toBe(false);
    expect(hasCrossFamilyKeys({ anthropic: "y" })).toBe(false);
    expect(hasCrossFamilyKeys({ openai: "x", anthropic: "y" })).toBe(true);
  });

  it("names all three ways to provide keys, and says one key is enough", () => {
    const msg = missingKeysError().message;
    expect(msg).toMatch(/OPENAI_API_KEY/);
    expect(msg).toMatch(/ANTHROPIC_API_KEY/);
    expect(msg).toMatch(/ONE of/);
    expect(msg).toMatch(/\.env/);
    expect(msg).toMatch(/saylent keys/);
  });

  // #7: the one instruction in the first-run error used to be "run `saylent
  // keys`", which prints a subcommand list and sets nothing.
  it("gives the command that actually SETS a key, not the one that lists them", () => {
    const msg = missingKeysError().message;
    expect(msg).toContain("saylent keys set openai");
    expect(msg).toContain("saylent keys set anthropic");
  });

  it("says where to get a key — both consoles, in full", () => {
    const msg = missingKeysError().message;
    expect(msg).toContain("https://platform.openai.com/api-keys");
    expect(msg).toContain("https://console.anthropic.com/settings/keys");
  });

  it("is headed and indented like every other block, not printed flush-left", () => {
    const msg = missingKeysError().message;
    expect(msg).toMatch(/Saylent . keys/);
    for (const line of msg.split("\n")) {
      if (line.trim() === "" || line.startsWith("Saylent")) continue;
      expect(line.startsWith("  ")).toBe(true);
    }
  });

  it("keyHelpLines carries the env-var form for both shells and the .env form", () => {
    const text = keyHelpLines().join("\n");
    expect(text).toContain("export OPENAI_API_KEY=");
    expect(text).toContain('$env:OPENAI_API_KEY="sk-..."');
    expect(text).toMatch(/\.env file in this folder/);
  });
});

describe("applyKeysToEnv", () => {
  it("sets process.env for every resolved key", () => {
    applyKeysToEnv({ openai: "sk-a", anthropic: "sk-ant-b" });
    expect(process.env.OPENAI_API_KEY).toBe("sk-a");
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-b");
  });
});

describe("PROVIDER_TO_ENGINE", () => {
  it("maps every provider to its answer engine", () => {
    expect(PROVIDER_TO_ENGINE.openai).toBe("chatgpt");
    expect(PROVIDER_TO_ENGINE.anthropic).toBe("claude");
    expect(PROVIDERS.map((p) => p.id).sort()).toEqual(["anthropic", "gemini", "openai", "perplexity"]);
  });
});

describe("redaction (keys never appear in logs/errors)", () => {
  // Split so this test's own source text (which ships in the public
  // snapshot) doesn't itself contain a real-looking key shape contiguously -
  // this test specifically validates redaction of a realistic key value, so
  // the runtime value must still look real.
  const SECRET = "sk-ant-super-secret-" + "key-value";

  it("redactSecrets replaces every occurrence", () => {
    const out = redactSecrets(`error calling with key ${SECRET} and again ${SECRET}`, [SECRET]);
    expect(out).not.toContain(SECRET);
    expect(out).toBe("error calling with key [redacted] and again [redacted]");
  });

  it("never redacts short/undefined values (avoids nuking unrelated text)", () => {
    expect(redactSecrets("short ok", ["ok", undefined])).toBe("short ok");
  });

  it("redactError strips a secret out of a thrown error's message", () => {
    const thrown = new Error(`request failed: Authorization: Bearer ${SECRET}`);
    const safe = redactError(thrown, [SECRET]);
    expect(safe.message).not.toContain(SECRET);
    expect(String(safe)).not.toContain(SECRET);
  });

  it("maskKey never returns the full key", () => {
    const masked = maskKey(SECRET);
    expect(masked).not.toContain(SECRET);
    expect(masked.length).toBeLessThan(SECRET.length);
  });

  it("applyKeysToEnv registers every key so a LATER, unrelated thrown error is redacted at the point index.ts prints it", () => {
    clearRegisteredSecrets();
    applyKeysToEnv({ openai: "sk-openai-leak-test-1", anthropic: "sk-ant-leak-test-2" });
    // Simulates a real failure mode: an SDK exception whose message happens
    // to embed the key it was sent with (e.g. an echoed Authorization
    // header in a provider's error body).
    const sdkError = `OpenAI request failed: Authorization: Bearer sk-openai-leak-test-1 (401 Unauthorized)`;
    const printed = redactKnownSecrets(sdkError);
    expect(printed).not.toContain("sk-openai-leak-test-1");
    expect(printed).toContain("[redacted]");
    clearRegisteredSecrets();
  });

  it("never registers a value never resolved (no false redaction of unrelated text)", () => {
    clearRegisteredSecrets();
    applyKeysToEnv({});
    expect(redactKnownSecrets("nothing secret here")).toBe("nothing secret here");
  });
});
