// API keys, the moment most CLIs feel sloppy. Resolution
// order: environment variables -> `.env` in the current folder ->
// ~/.saylent/config.json (owner-only permissions). First run with no keys
// prompts interactively on a TTY; otherwise a clear error names the three
// ways to provide keys. Keys are never printed, never written into run.json
// or a report, and every string this module hands back for display is
// pre-masked (see redact.ts for the log/error-output side of that rule).
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Engine } from "@saylent/engine";
import { maskKey, registerSecret } from "./redact";
import { glyph } from "./glyphs";

export type Provider = "openai" | "anthropic" | "gemini" | "perplexity";
export type KeySource = "env" | ".env" | "~/.saylent/config.json";

export interface ProviderSpec {
  id: Provider;
  envVar: string;
  label: string;
  hint: string;
  /** a judgment family (brand model, drafter, judge). ONE of these is enough to
   *  run: with both, judging is cross-family; with one, single-family. */
  required: boolean;
}

export const PROVIDERS: ProviderSpec[] = [
  {
    id: "openai",
    envVar: "OPENAI_API_KEY",
    label: "OpenAI",
    hint: "starts with sk-, from platform.openai.com/api-keys",
    required: true,
  },
  {
    id: "anthropic",
    envVar: "ANTHROPIC_API_KEY",
    label: "Anthropic",
    hint: "starts with sk-ant-, from console.anthropic.com",
    required: true,
  },
  {
    id: "gemini",
    envVar: "GEMINI_API_KEY",
    label: "Gemini",
    hint: "from aistudio.google.com/apikey",
    required: false,
  },
  {
    id: "perplexity",
    envVar: "PERPLEXITY_API_KEY",
    label: "Perplexity",
    hint: "from perplexity.ai/settings/api",
    required: false,
  },
];

export const PROVIDER_TO_ENGINE: Record<Provider, Engine> = {
  openai: "chatgpt",
  anthropic: "claude",
  gemini: "gemini",
  perplexity: "perplexity",
};

export type KeyMap = Partial<Record<Provider, string>>;
export type SourceMap = Partial<Record<Provider, KeySource>>;

/** process.env.HOME (POSIX) / USERPROFILE (Windows) first, os.homedir() as
 *  the last resort. Reading the env var directly (rather than only
 *  os.homedir()) is standard CLI practice — it lets a test or a wrapper
 *  script override where ~/.saylent lives without touching real dotfiles —
 *  and sidesteps an observed inconsistency where os.homedir() did not always
 *  reflect a same-process HOME change (verified empirically in this repo's
 *  own test run; process.env.HOME itself always read correctly). */
function homeDirectory(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

export function saylentHome(): string {
  return path.join(homeDirectory(), ".saylent");
}

export function configFilePath(): string {
  return path.join(saylentHome(), "config.json");
}

/** A minimal, dependency-free `.env` parser: `KEY=VALUE` per line, `#` comments,
 *  blank lines skipped, surrounding single/double quotes stripped. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

function readDotEnvFile(cwd: string): Record<string, string> {
  const file = path.join(cwd, ".env");
  if (!existsSync(file)) return {};
  try {
    return parseDotEnv(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

interface ConfigFile {
  keys?: Partial<Record<Provider, string>>;
}

export function readConfigFile(): ConfigFile {
  const file = configFilePath();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (parsed && typeof parsed === "object") return parsed as ConfigFile;
    return {};
  } catch {
    return {};
  }
}

/** Owner-only permissions (chmod 600) — skipped on win32, which has no POSIX
 *  mode bits; NTFS ACLs already default a user's profile directory private. */
export function writeConfigFile(data: ConfigFile): void {
  const dir = saylentHome();
  mkdirSync(dir, { recursive: true });
  const file = configFilePath();
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  if (process.platform !== "win32") {
    try {
      chmodSync(file, 0o600);
    } catch {
      /* best effort — a read-only mount or unusual fs must not crash the CLI */
    }
  }
}

export interface ResolvedKeys {
  keys: KeyMap;
  sources: SourceMap;
}

/** env -> .env in cwd -> ~/.saylent/config.json, per provider. A later source
 *  never overrides an earlier one that already has a non-empty value. */
export function resolveKeys(cwd: string = process.cwd()): ResolvedKeys {
  const dotEnv = readDotEnvFile(cwd);
  const configured = readConfigFile().keys ?? {};
  const keys: KeyMap = {};
  const sources: SourceMap = {};
  for (const p of PROVIDERS) {
    const fromEnv = process.env[p.envVar]?.trim();
    const fromDotEnv = dotEnv[p.envVar]?.trim();
    const fromConfig = configured[p.id]?.trim();
    if (fromEnv) {
      keys[p.id] = fromEnv;
      sources[p.id] = "env";
    } else if (fromDotEnv) {
      keys[p.id] = fromDotEnv;
      sources[p.id] = ".env";
    } else if (fromConfig) {
      keys[p.id] = fromConfig;
      sources[p.id] = "~/.saylent/config.json";
    }
  }
  return { keys, sources };
}

/** llm.ts (the brand/judge/drafter callers) reads process.env directly, so a
 *  key resolved from .env or ~/.saylent/config.json must still be applied to
 *  process.env before runAudit() is called. */
export function applyKeysToEnv(keys: KeyMap): void {
  for (const p of PROVIDERS) {
    const value = keys[p.id];
    if (value) {
      process.env[p.envVar] = value;
      registerSecret(value); // redacted from every later log/error line
    }
  }
}

/** SINGLE-PROVIDER MODE: one judgment family is enough to run a full audit —
 *  that family serves the brand model, the drafter and every judge, and the run
 *  is stamped judge_mode "single-family". Both keys keep cross-family judging.
 *  Gemini/Perplexity are answer engines only and never satisfy this. */
export function hasMinimumKeys(keys: KeyMap): boolean {
  return Boolean(keys.openai || keys.anthropic);
}

/** True when BOTH judgment families are available (cross-family judging). */
export function hasCrossFamilyKeys(keys: KeyMap): boolean {
  return Boolean(keys.openai && keys.anthropic);
}

export function everyKeyValue(keys: KeyMap): string[] {
  return PROVIDERS.map((p) => keys[p.id]).filter((v): v is string => Boolean(v));
}

/** Where a key is minted, per judgment provider. Printed by the first-run
 *  error and by `saylent keys list`: "get a key" is useless without the URL,
 *  and the non-TTY path (CI, pipes, a WSL shell without a terminal) never sees
 *  the interactive prompt's own hints. */
export const KEY_CONSOLE_URLS: { label: string; url: string }[] = [
  { label: "OpenAI", url: "https://platform.openai.com/api-keys" },
  { label: "Anthropic", url: "https://console.anthropic.com/settings/keys" },
];

/** The three ways to provide a key, each as a command you can actually run —
 *  the old text said "Run `saylent keys`", which prints a subcommand list and
 *  sets nothing. Shared by the first-run error, `keys list` and `keys` with no
 *  subcommand, so all three teach the same thing. */
export function keyHelpLines(indent = "  "): string[] {
  return [
    `${indent}1. saylent keys set openai        (or: saylent keys set anthropic)`,
    `${indent}   Saved to ~/.saylent/config.json, chmod 600. Never on the command line.`,
    `${indent}2. export OPENAI_API_KEY=sk-...   (PowerShell: $env:OPENAI_API_KEY="sk-...")`,
    `${indent}3. A .env file in this folder:    OPENAI_API_KEY=sk-...`,
    "",
    ...KEY_CONSOLE_URLS.map(
      (c, i) => `${indent}${(i === 0 ? "Get a key" : "").padEnd(11)}${c.label.padEnd(11)}${c.url}`,
    ),
  ];
}

/** The exact three ways to provide keys, for the non-interactive failure case
 * ("otherwise a clear error") — indented and headed like every other block the
 * CLI prints, so it reads as an instruction and not as a crash. */
export function missingKeysError(): Error {
  return new Error(
    [
      `\nSaylent ${glyph("sep")} keys\n`,
      "  No provider key found. ONE of OPENAI_API_KEY or ANTHROPIC_API_KEY is enough",
      "  to run; both give cross-family judging. Three ways to provide one:",
      "",
      ...keyHelpLines("    "),
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// interactive first-run prompt (TTY only)
// ---------------------------------------------------------------------------

export interface PromptIO {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

/** Read one line with the input masked as "●" per keystroke (a real terminal
 *  password prompt). Falls back to plain echo when the stream can't be put
 *  into raw mode (piped input, some CI terminals) — never crashes. */
export function readMasked(io: PromptIO, question: string): Promise<string> {
  return new Promise((resolve) => {
    const { input, output } = io;
    output.write(question);
    const rl = createInterface({ input, output, terminal: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- readline's mask hook is undocumented but stable
    const anyRl = rl as any;
    const original = anyRl._writeToOutput?.bind(anyRl);
    let buffer = "";
    if (original) {
      anyRl._writeToOutput = (str: string) => {
        if (str === "\r\n" || str === "\n") {
          original(str);
          return;
        }
        // readline echoes the whole line on every keystroke; count printable
        // chars actually typed so far instead of re-parsing str.
        original(str.replace(/[^\r\n]/g, glyph("dot")));
      };
    }
    rl.question("", (answer) => {
      buffer = answer;
      rl.close();
      output.write("\n");
      resolve(buffer.trim());
    });
  });
}

export interface PromptResult {
  keys: KeyMap;
  /** provider -> "valid" | "invalid" | "skipped" | "unchecked" (test call failed to run, not the key) */
  validity: Partial<Record<Provider, "valid" | "invalid" | "skipped" | "unchecked">>;
}

export type KeyTester = (provider: Provider, key: string) => Promise<boolean | null>;

/** The first-run flow: OpenAI + Anthropic required (blank ->
 *  re-ask once, then accept blank and let the caller report missing keys),
 *  Gemini + Perplexity optional ("[skip]" on an empty answer). */
export async function promptForKeys(io: PromptIO, test: KeyTester): Promise<PromptResult> {
  const { output } = io;
  output.write(
    "  No provider keys found. Saylent runs on YOUR keys; nothing goes through us.\n" +
      "  One of OpenAI or Anthropic is enough; both give cross-family judging.\n",
  );
  const keys: KeyMap = {};
  const validity: PromptResult["validity"] = {};

  for (const p of PROVIDERS) {
    const optional = !p.required;
    const label = optional
      ? `  ${p.label} (optional, ${p.hint}) [skip]: `
      : `  ${p.label} key (${p.hint}) [skip if you have the other]: `;
    const value = await readMasked(io, label);
    if (!value) {
      validity[p.id] = "skipped";
      continue;
    }
    keys[p.id] = value;
    try {
      const ok = await test(p.id, value);
      validity[p.id] = ok === null ? "unchecked" : ok ? "valid" : "invalid";
    } catch {
      validity[p.id] = "unchecked";
    }
    const mark =
      validity[p.id] === "valid"
        ? `${glyph("check")} valid`
        : validity[p.id] === "invalid"
          ? `${glyph("cross")} invalid`
          : "(unchecked)";
    output.write(`    ${maskKey(value)}  ${mark}\n`);
  }

  return { keys, validity };
}

export function saveKeys(existing: KeyMap, updates: KeyMap): void {
  const merged: KeyMap = { ...existing, ...updates };
  writeConfigFile({ keys: merged });
}
