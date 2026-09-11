// `saylent models` — read-only, $0, no network. @saylent/engine is imported
// STATICALLY (see run.test.ts's TESTABILITY NOTE: a dynamic import() of
// @saylent/engine was measured to hang under vitest).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as engineMod from "@saylent/engine";
import { loadConfig } from "@saylent/engine/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runModelsCommandWith } from "./models";

let home: string;
let cwd: string;
let prevHome: string | undefined;
const prevEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  prevHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "saylent-models-home-"));
  cwd = mkdtempSync(path.join(tmpdir(), "saylent-models-cwd-"));
  process.env.HOME = home;
  for (const k of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "PERPLEXITY_API_KEY",
    "MODEL_JUDGE_ANTHROPIC",
    "MODEL_JUDGE_OPENAI",
  ]) {
    prevEnv[k] = process.env[k];
    delete process.env[k];
  }
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
  process.env.HOME = prevHome;
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

function capture(): { lines: string[]; out: (l: string) => void } {
  const lines: string[] = [];
  return { lines, out: (l) => lines.push(l) };
}

const configMod = { loadConfig };

describe("runModelsCommandWith", () => {
  it("--help prints usage and exits 0", async () => {
    const { lines, out } = capture();
    const code = await runModelsCommandWith(engineMod, configMod, ["--help"], out);
    expect(code).toBe(0);
    expect(lines.join("")).toContain("saylent models");
  });

  it("prints the shipped defaults with source 'default' when nothing overrides them", async () => {
    const { lines, out } = capture();
    const code = await runModelsCommandWith(engineMod, configMod, [], out);
    expect(code).toBe(0);
    const text = lines.join("");
    expect(text).toContain("claude-haiku-4-5");
    expect(text).toContain("default");
    expect(text).toContain("no saylent.config models block");
  });

  it("a MODEL_* env var changes the printed source to 'env'", async () => {
    process.env.MODEL_JUDGE_ANTHROPIC = "claude-env-judge";
    const { lines, out } = capture();
    await runModelsCommandWith(engineMod, configMod, [], out);
    const text = lines.join("");
    expect(text).toContain("claude-env-judge");
    expect(text).toMatch(/env\s+MODEL_JUDGE_ANTHROPIC/);
  });

  it("saylent.config models changes the printed source to 'config' and says so in the header", async () => {
    writeFileSync(
      path.join(cwd, "saylent.config.json"),
      JSON.stringify({ models: { judge: { anthropic: "claude-config-judge" } } }),
    );
    const { lines, out } = capture();
    await runModelsCommandWith(engineMod, configMod, [], out);
    const text = lines.join("");
    expect(text).toContain("claude-config-judge");
    expect(text).toContain("saylent.config models applied");
  });

  it("--judge beats both env and config (flag wins)", async () => {
    process.env.MODEL_JUDGE_ANTHROPIC = "claude-env-judge";
    writeFileSync(
      path.join(cwd, "saylent.config.json"),
      JSON.stringify({ models: { judge: { anthropic: "claude-config-judge" } } }),
    );
    const { lines, out } = capture();
    const code = await runModelsCommandWith(
      engineMod,
      configMod,
      ["--judge", "claude-flag-judge", "--judge-family", "anthropic"],
      out,
    );
    expect(code).toBe(0);
    expect(lines.join("")).toContain("claude-flag-judge");
  });

  it("an ambiguous --judge model without --judge-family exits 1 with a clear error", async () => {
    const errLines: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
      errLines.push(String(c));
      return true;
    });
    const { out } = capture();
    const code = await runModelsCommandWith(engineMod, configMod, ["--judge", "mystery-model"], out);
    spy.mockRestore();
    expect(code).toBe(1);
    expect(errLines.join("")).toMatch(/cannot tell which provider/);
  });

  it("shows which models would judge each engine, and flags self-judging when an override collides", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai"; // single-family: judge = the answer engine's own family
    process.env.MODEL_JUDGE_OPENAI = "gpt-5.4"; // == the default chatgpt answer model
    const { lines, out } = capture();
    await runModelsCommandWith(engineMod, configMod, [], out);
    const text = lines.join("");
    expect(text).toContain("This run would judge:");
    expect(text).toMatch(/Warning[\s\S]*self-judging/);
  });
});
