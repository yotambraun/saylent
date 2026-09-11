// saylent.config.{json,js,mjs,ts} loader — no live LLM calls, $0. Each test
// writes a real config file into a temp cwd and loads it for real (no fakes
// for the filesystem itself: this module's whole job IS reading disk).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, mergeConfig, saylentConfigSchema } from "./config";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), "saylent-config-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns {config:{}, source:null} when no config file exists", async () => {
    const cwd = tempDir();
    const loaded = await loadConfig(cwd);
    expect(loaded).toEqual({ config: {}, source: null });
  });

  it("loads saylent.config.json", async () => {
    const cwd = tempDir();
    writeFileSync(
      path.join(cwd, "saylent.config.json"),
      JSON.stringify({ competitors: ["globex.example"], profile: "smoke" }),
    );
    const loaded = await loadConfig(cwd);
    expect(loaded.source).toBe(path.join(cwd, "saylent.config.json"));
    expect(loaded.config.competitors).toEqual(["globex.example"]);
    expect(loaded.config.profile).toBe("smoke");
  });

  it("loads saylent.config.mjs (default export)", async () => {
    const cwd = tempDir();
    writeFileSync(
      path.join(cwd, "saylent.config.mjs"),
      "export default { engines: ['chatgpt', 'claude'], userAgent: 'MyBot/1.0' };\n",
    );
    const loaded = await loadConfig(cwd);
    expect(loaded.config.engines).toEqual(["chatgpt", "claude"]);
    expect(loaded.config.userAgent).toBe("MyBot/1.0");
  });

  it("loads saylent.config.js (default export)", async () => {
    const cwd = tempDir();
    writeFileSync(
      path.join(cwd, "saylent.config.js"),
      "export default { branding: { appName: 'Acme Audit' } };\n",
    );
    const loaded = await loadConfig(cwd);
    expect(loaded.config.branding).toEqual({ appName: "Acme Audit" });
  });

  it("loads saylent.config.ts via tsx (tsx is a repo devDependency)", async () => {
    const cwd = tempDir();
    writeFileSync(
      path.join(cwd, "saylent.config.ts"),
      "const config = { profile: 'full' as const, locale: 'en-GB' };\nexport default config;\n",
    );
    const loaded = await loadConfig(cwd);
    expect(loaded.source).toBe(path.join(cwd, "saylent.config.ts"));
    expect(loaded.config.profile).toBe("full");
    expect(loaded.config.locale).toBe("en-GB");
  }, 20000);

  it("prefers .json over .js/.mjs/.ts when several exist", async () => {
    const cwd = tempDir();
    writeFileSync(path.join(cwd, "saylent.config.json"), JSON.stringify({ locale: "from-json" }));
    writeFileSync(path.join(cwd, "saylent.config.js"), "export default { locale: 'from-js' };\n");
    const loaded = await loadConfig(cwd);
    expect(loaded.config.locale).toBe("from-json");
  });

  it("throws a clear error on invalid JSON", async () => {
    const cwd = tempDir();
    writeFileSync(path.join(cwd, "saylent.config.json"), "{ not valid json");
    await expect(loadConfig(cwd)).rejects.toThrow(/saylent config: failed to load/);
  });

  it("throws a clear error when the shape fails schema validation", async () => {
    const cwd = tempDir();
    writeFileSync(path.join(cwd, "saylent.config.json"), JSON.stringify({ profile: "turbo" }));
    await expect(loadConfig(cwd)).rejects.toThrow(/saylent config: invalid/);
  });

  it("accepts every documented optional field", () => {
    const parsed = saylentConfigSchema.safeParse({
      questionTemplates: { custom_launch: { templates: ["custom question"] } },
      models: { judge: { anthropic: "claude-haiku-4-5" }, brand: "claude-haiku-4-5", engines: { chatgpt: "gpt-5.4" } },
      competitors: ["globex.example"],
      engines: ["chatgpt", "gemini"],
      profile: "smoke",
      userAgent: "MyBot/1.0",
      maxPages: 10,
      allowPrivate: true,
      extraBots: [{ agent: "MyBot", kind: "user" }],
      thresholds: { coverage: 0.5, fixWeights: { access: 8 } },
      branding: { appName: "Acme", contactEmail: "hi@acme.example" },
      locale: "en-US",
      skip: { drafts: true, corpus: false, gates: true },
    });
    expect(parsed.success).toBe(true);
  });

  // The skip config.
  it("accepts a partial skip and rejects a non-boolean stage", () => {
    expect(saylentConfigSchema.safeParse({ skip: {} }).success).toBe(true);
    expect(saylentConfigSchema.safeParse({ skip: { corpus: true } }).success).toBe(true);
    expect(saylentConfigSchema.safeParse({ skip: { drafts: "yes" } }).success).toBe(false);
    expect(saylentConfigSchema.safeParse({ skip: { bogus: true } }).success).toBe(true); // unknown keys ignored by zod default (strip)
  });

  // maxPages/allowPrivate validation.
  it("rejects an out-of-range maxPages", () => {
    expect(saylentConfigSchema.safeParse({ maxPages: 0 }).success).toBe(false);
    expect(saylentConfigSchema.safeParse({ maxPages: 201 }).success).toBe(false);
    expect(saylentConfigSchema.safeParse({ maxPages: 1.5 }).success).toBe(false);
  });

  it("accepts a valid maxPages", () => {
    expect(saylentConfigSchema.safeParse({ maxPages: 50 }).success).toBe(true);
  });

  it("rejects a non-boolean allowPrivate", () => {
    expect(saylentConfigSchema.safeParse({ allowPrivate: "yes" }).success).toBe(false);
  });

  it("defaults maxPages/allowPrivate to absent (no cap, never on)", () => {
    const parsed = saylentConfigSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.maxPages).toBeUndefined();
      expect(parsed.data.allowPrivate).toBeUndefined();
    }
  });
});

describe("mergeConfig", () => {
  it("later layers win field by field; undefined never overwrites", () => {
    const merged = mergeConfig(
      { profile: "full", competitors: ["a.example"] },
      { profile: undefined, userAgent: "env-ua" },
      { profile: "smoke" },
    );
    expect(merged).toEqual({ profile: "smoke", competitors: ["a.example"], userAgent: "env-ua" });
  });

  it("skips undefined/missing layers entirely", () => {
    expect(mergeConfig(undefined, { locale: "en-GB" }, undefined)).toEqual({ locale: "en-GB" });
  });
});

// ---------------------------------------------------------------------------
// `saylent.config.{js,mjs,ts}` EXECUTES on load. The CLI keeps that
// (a human chose the directory); the MCP server passes allowExecutable:false.
// ---------------------------------------------------------------------------
describe("loadConfig allowExecutable", () => {
  it("skips an executable config and reports it, instead of running it", async () => {
    const cwd = tempDir();
    writeFileSync(path.join(cwd, "saylent.config.js"), 'export default { profile: "full" };\n', "utf8");
    const skipped: string[] = [];
    const loaded = await loadConfig(cwd, { allowExecutable: false, onSkipped: (f) => skipped.push(f) });
    expect(loaded).toEqual({ config: {}, source: null });
    expect(skipped).toEqual([path.join(cwd, "saylent.config.js")]);
  });

  it("skips .mjs and .ts the same way", async () => {
    for (const name of ["saylent.config.mjs", "saylent.config.ts"]) {
      const cwd = tempDir();
      writeFileSync(path.join(cwd, name), 'export default { profile: "full" };\n', "utf8");
      const loaded = await loadConfig(cwd, { allowExecutable: false });
      expect(loaded.source).toBeNull();
    }
  });

  it("still loads saylent.config.json with allowExecutable:false", async () => {
    const cwd = tempDir();
    writeFileSync(path.join(cwd, "saylent.config.json"), JSON.stringify({ profile: "full" }), "utf8");
    // both present: the .json wins and the .js is skipped, not executed
    writeFileSync(path.join(cwd, "saylent.config.js"), "throw new Error('executed!');\n", "utf8");
    const loaded = await loadConfig(cwd, { allowExecutable: false });
    expect(loaded.config.profile).toBe("full");
    expect(loaded.source).toBe(path.join(cwd, "saylent.config.json"));
  });

  it("defaults to allowing executable configs, so the CLI is unchanged", async () => {
    const cwd = tempDir();
    writeFileSync(path.join(cwd, "saylent.config.mjs"), 'export default { profile: "full" };\n', "utf8");
    const loaded = await loadConfig(cwd);
    expect(loaded.config.profile).toBe("full");
    expect(loaded.source).toBe(path.join(cwd, "saylent.config.mjs"));
  });
});
