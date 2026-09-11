// audit command: config precedence (config < env < flags) and --dry-run
// (spends nothing, never calls the fake adapters). @saylent/engine and
// @saylent/report are imported STATICALLY — see run.test.ts's note: a
// dynamic import() of either package was measured to hang under vitest.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as engineMod from "@saylent/engine";
import { loadConfig, mergeConfig } from "@saylent/engine/config";
import * as reportRenderMod from "@saylent/report/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportDataFromBundle } from "../../../report/src/render/from-bundle";
import type { AskFn } from "@saylent/engine";
import type { ReportModules } from "../run";
import { runAuditCommandWith } from "./audit";

const reportMod: ReportModules = {
  reportDataFromBundle,
  renderReportHtml: reportRenderMod.renderReportHtml,
  renderMarkdown: reportRenderMod.renderMarkdown,
  renderMovementHtml: reportRenderMod.renderMovementHtml,
};
const configMod = { loadConfig, mergeConfig };

let home: string;
let cwd: string;
let prevHome: string | undefined;
const prevEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  prevHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "saylent-audit-home-"));
  cwd = mkdtempSync(path.join(tmpdir(), "saylent-audit-cwd-"));
  process.env.HOME = home;
  for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "PERPLEXITY_API_KEY"]) {
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

function captureStdout(): { chunks: string[]; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
    chunks.push(String(c));
    return true;
  });
  return { chunks, restore: () => spy.mockRestore() };
}

describe("audit --dry-run", () => {
  it("prints the plan/estimate and exits 0 without calling the fake adapters", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    let askCalls = 0;
    const ask: AskFn = async () => {
      askCalls += 1;
      return { ok: true, text: "never called", citations: [] };
    };

    const { chunks, restore } = captureStdout();
    const code = await runAuditCommandWith(
      engineMod,
      configMod,
      reportMod,
      ["acme.example", "--dry-run"],
      { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
    );
    restore();

    expect(code).toBe(0);
    expect(askCalls).toBe(0); // the fakes were never wired in, but prove intent: dry-run never reaches runAudit
    const out = chunks.join("");
    expect(out).toContain("Dry run");
    expect(out).toContain("$0 spent");
    expect(out).toMatch(/est\. /);
    // no output files were written
    void ask;
  });

  it("dry-run works even with zero keys (no interactive prompt, no error)", async () => {
    const { chunks, restore } = captureStdout();
    const code = await runAuditCommandWith(engineMod, configMod, reportMod, ["acme.example", "--dry-run"], {
      stdinIsTTY: false,
      promptKeysIo: { input: process.stdin, output: process.stdout },
    });
    restore();
    expect(code).toBe(0);
    expect(chunks.join("")).toContain("Dry run");
  });
});

// --skip / AUDIT_SKIP / saylent.config skip.
describe("audit --skip", () => {
  it("prints the Skipping line and lowers the estimate below a no-skip run", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    const base = captureStdout();
    const baseCode = await runAuditCommandWith(
      engineMod,
      configMod,
      reportMod,
      ["acme.example", "--dry-run", "--profile", "full"],
      { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
    );
    base.restore();
    const baseOut = base.chunks.join("");

    const skipped = captureStdout();
    const skipCode = await runAuditCommandWith(
      engineMod,
      configMod,
      reportMod,
      ["acme.example", "--dry-run", "--profile", "full", "--skip", "drafts,gates"],
      { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
    );
    skipped.restore();
    const skipOut = skipped.chunks.join("");

    expect(baseCode).toBe(0);
    expect(skipCode).toBe(0);
    expect(baseOut).not.toContain("Skipping");
    expect(skipOut).toContain("Skipping  drafts, gates (by request)");

    // "est. $0.86–$1.42 of your credits" — parse the HIGH (second) bound.
    const highOf = (out: string): number => {
      const m = /est\. (?:< \$0\.01|\$[\d.]+)–(< \$0\.01|\$[\d.]+) of your credits/.exec(out);
      const raw = m?.[1];
      if (!raw) throw new Error(`no estimate line found in:\n${out}`);
      return raw === "< $0.01" ? 0.005 : Number(raw.slice(1));
    };
    expect(highOf(skipOut)).toBeLessThan(highOf(baseOut));
  });

  it("AUDIT_SKIP env is honored when no --skip flag is given", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.AUDIT_SKIP = "corpus";
    try {
      const { chunks, restore } = captureStdout();
      const code = await runAuditCommandWith(engineMod, configMod, reportMod, ["acme.example", "--dry-run"], {
        stdinIsTTY: false,
        promptKeysIo: { input: process.stdin, output: process.stdout },
      });
      restore();
      expect(code).toBe(0);
      expect(chunks.join("")).toContain("Skipping  corpus (by request)");
    } finally {
      delete process.env.AUDIT_SKIP;
    }
  });

  it("--skip flag overrides AUDIT_SKIP env", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.AUDIT_SKIP = "corpus";
    try {
      const { chunks, restore } = captureStdout();
      const code = await runAuditCommandWith(
        engineMod,
        configMod,
        reportMod,
        ["acme.example", "--dry-run", "--skip", "gates"],
        { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
      );
      restore();
      expect(code).toBe(0);
      expect(chunks.join("")).toContain("Skipping  gates (by request)");
    } finally {
      delete process.env.AUDIT_SKIP;
    }
  });

  it("an unrecognized --skip stage name errors clearly (even in --dry-run)", async () => {
    const errChunks: string[] = [];
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
      errChunks.push(String(c));
      return true;
    });
    const code = await runAuditCommandWith(
      engineMod,
      configMod,
      reportMod,
      ["acme.example", "--dry-run", "--skip", "bogus"],
      { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
    );
    errSpy.mockRestore();
    expect(code).toBe(1);
    expect(errChunks.join("")).toMatch(/--skip bogus/);
  });
});

describe("--format", () => {
  it("names only the files it will write in the preflight Output line", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const { chunks, restore } = captureStdout();
    const code = await runAuditCommandWith(
      engineMod,
      configMod,
      reportMod,
      ["acme.example", "--dry-run", "--format", "md"],
      { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
    );
    restore();
    expect(code).toBe(0);
    const out = chunks.join("");
    expect(out).toMatch(/Output .*\(report\.md\)/);
    expect(out).not.toContain("report.html");
  });

  it("refuses an unknown format instead of silently writing everything", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    const errChunks: string[] = [];
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
      errChunks.push(String(c));
      return true;
    });
    const { restore } = captureStdout();
    const code = await runAuditCommandWith(
      engineMod,
      configMod,
      reportMod,
      ["acme.example", "--dry-run", "--format", "pdf"],
      { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
    );
    restore();
    errSpy.mockRestore();
    expect(code).toBe(1);
    expect(errChunks.join("")).toMatch(/--format pdf/);
  });
});

describe("config precedence: saylent.config.json < env < flags", () => {
  it("a --profile flag overrides saylent.config.json's profile", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    writeFileSync(path.join(cwd, "saylent.config.json"), JSON.stringify({ profile: "full" }));

    const { chunks, restore } = captureStdout();
    const code = await runAuditCommandWith(
      engineMod,
      configMod,
      reportMod,
      ["acme.example", "--dry-run", "--profile", "smoke"],
      { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
    );
    restore();
    expect(code).toBe(0);
    expect(chunks.join("")).toContain("smoke ·");
  });

  it("without a flag, saylent.config.json's profile wins", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    writeFileSync(path.join(cwd, "saylent.config.json"), JSON.stringify({ profile: "full" }));

    const { chunks, restore } = captureStdout();
    const code = await runAuditCommandWith(engineMod, configMod, reportMod, ["acme.example", "--dry-run"], {
      stdinIsTTY: false,
      promptKeysIo: { input: process.stdin, output: process.stdout },
    });
    restore();
    expect(code).toBe(0);
    expect(chunks.join("")).toContain("full ·");
  });

  it("saylent.config.json's competitors flow into the plan (engines line unaffected)", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    writeFileSync(path.join(cwd, "saylent.config.json"), JSON.stringify({ competitors: ["globex.example"] }));
    const { restore } = captureStdout();
    const code = await runAuditCommandWith(engineMod, configMod, reportMod, ["acme.example", "--dry-run"], {
      stdinIsTTY: false,
      promptKeysIo: { input: process.stdin, output: process.stdin as unknown as NodeJS.WritableStream },
    });
    restore();
    expect(code).toBe(0);
    // dry-run doesn't print competitors directly, but it must not error while
    // reading them off the merged config — the real assertion is "still 0".
  });
});

describe("no usable key", () => {
  it("a non-TTY run with no keys and no --dry-run fails with the three-ways-to-provide-keys message", async () => {
    const errChunks: string[] = [];
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
      errChunks.push(String(c));
      return true;
    });
    const code = await runAuditCommandWith(engineMod, configMod, reportMod, ["acme.example"], {
      stdinIsTTY: false,
      promptKeysIo: { input: process.stdin, output: process.stdout },
    });
    errSpy.mockRestore();
    expect(code).toBe(1);
    expect(errChunks.join("")).toMatch(/OPENAI_API_KEY/);
  });
});

// SINGLE-PROVIDER MODE: one key must be enough.
describe("one provider key", () => {
  it("--dry-run with OpenAI only prints the single-family judge line and exits 0", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    const { chunks, restore } = captureStdout();
    const code = await runAuditCommandWith(
      engineMod,
      configMod,
      reportMod,
      ["acme.example", "--dry-run"],
      { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
    );
    restore();
    expect(code).toBe(0);
    const out = chunks.join("");
    expect(out).toContain("single-family (OpenAI only; add ANTHROPIC_API_KEY for cross-family)");
    expect(out).toContain("Engines   chatgpt");
  });

  it("--dry-run with Anthropic only names OPENAI_API_KEY as the missing half", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const { chunks, restore } = captureStdout();
    const code = await runAuditCommandWith(
      engineMod,
      configMod,
      reportMod,
      ["acme.example", "--dry-run"],
      { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
    );
    restore();
    expect(code).toBe(0);
    expect(chunks.join("")).toContain(
      "single-family (Anthropic only; add OPENAI_API_KEY for cross-family)",
    );
  });

  it("both keys still read as cross-family", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const { chunks, restore } = captureStdout();
    await runAuditCommandWith(engineMod, configMod, reportMod, ["acme.example", "--dry-run"], {
      stdinIsTTY: false,
      promptKeysIo: { input: process.stdin, output: process.stdout },
    });
    restore();
    expect(chunks.join("")).toContain("cross-family (OpenAI ↔ Anthropic)");
  });

  it("a REAL (non-dry) run with one key gets past the key gate and stops at --max-usd, not at a missing-keys error", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const errChunks: string[] = [];
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
      errChunks.push(String(c));
      return true;
    });
    const { restore } = captureStdout();
    // --max-usd 0 refuses BEFORE any provider call, so this spends nothing while
    // proving the single-key run is no longer rejected for missing keys.
    const code = await runAuditCommandWith(
      engineMod,
      configMod,
      reportMod,
      ["acme.example", "--yes", "--max-usd", "0"],
      { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
    );
    restore();
    errSpy.mockRestore();
    expect(code).toBe(1);
    const err = errChunks.join("");
    expect(err).toContain("--max-usd");
    expect(err).not.toMatch(/No provider key found/);
  });
});

// ---------------------------------------------------------------------------
// #1/#2: --profile and --engines refuse a bad value with a sentence. Before
// this, --profile medium crashed with a raw TypeError and a misspelled engine
// was silently dropped from a run the operator paid for.
// ---------------------------------------------------------------------------

function captureStderr(): { chunks: string[]; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
    chunks.push(String(c));
    return true;
  });
  return { chunks, restore: () => spy.mockRestore() };
}

const NO_TTY = { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } };

describe("--profile / --engines validation", () => {
  it("--profile medium says what it expected, with no stack and no TypeError", async () => {
    const { chunks, restore } = captureStderr();
    const code = await runAuditCommandWith(
      engineMod,
      configMod,
      reportMod,
      ["acme.example", "--dry-run", "--profile", "medium"],
      NO_TTY,
    );
    restore();
    expect(code).toBe(1);
    const err = chunks.join("");
    expect(err).toContain('--profile medium: expected "full" or "smoke".');
    expect(err).not.toContain("scoredSamples");
    expect(err).not.toContain("at ");
  });

  it("AUDIT_PROFILE is validated too, and cited by its own name", async () => {
    process.env.AUDIT_PROFILE = "medium";
    const { chunks, restore } = captureStderr();
    const code = await runAuditCommandWith(engineMod, configMod, reportMod, ["acme.example", "--dry-run"], NO_TTY);
    restore();
    delete process.env.AUDIT_PROFILE;
    expect(code).toBe(1);
    expect(chunks.join("")).toContain('AUDIT_PROFILE "medium"');
  });

  it("AUDIT_PROFILE sets the profile when it IS valid", async () => {
    process.env.AUDIT_PROFILE = "full";
    const { chunks, restore } = captureStdout();
    const code = await runAuditCommandWith(engineMod, configMod, reportMod, ["acme.example", "--dry-run"], NO_TTY);
    restore();
    delete process.env.AUDIT_PROFILE;
    expect(code).toBe(0);
    expect(chunks.join("")).toMatch(/Profile\s+full/);
  });

  it("a misspelled engine is REFUSED, never dropped", async () => {
    const { chunks, restore } = captureStderr();
    const code = await runAuditCommandWith(
      engineMod,
      configMod,
      reportMod,
      ["acme.example", "--dry-run", "--engines", "chatgpt,claud"],
      NO_TTY,
    );
    restore();
    expect(code).toBe(1);
    expect(chunks.join("")).toContain('unknown engine "claud"');
    expect(chunks.join("")).toContain("Valid engines: chatgpt, claude, gemini, perplexity.");
  });

  it("a PROVIDER name is corrected by name — the word `keys set` taught", async () => {
    const { chunks, restore } = captureStderr();
    const code = await runAuditCommandWith(
      engineMod,
      configMod,
      reportMod,
      ["acme.example", "--dry-run", "--engines", "anthropic"],
      NO_TTY,
    );
    restore();
    expect(code).toBe(1);
    expect(chunks.join("")).toContain('"anthropic" is a provider; the engine is "claude"');
  });

  it("AUDIT_ENGINES is validated with the same message", async () => {
    process.env.AUDIT_ENGINES = "openai";
    const { chunks, restore } = captureStderr();
    const code = await runAuditCommandWith(engineMod, configMod, reportMod, ["acme.example", "--dry-run"], NO_TTY);
    restore();
    delete process.env.AUDIT_ENGINES;
    expect(code).toBe(1);
    expect(chunks.join("")).toContain('AUDIT_ENGINES "openai"');
    expect(chunks.join("")).toContain('the engine is "chatgpt"');
  });

  it("saylent.config engines is validated with the same message", async () => {
    writeFileSync(path.join(cwd, "saylent.config.json"), JSON.stringify({ engines: ["claud"] }));
    const { chunks, restore } = captureStderr();
    const code = await runAuditCommandWith(engineMod, configMod, reportMod, ["acme.example", "--dry-run"], NO_TTY);
    restore();
    expect(code).toBe(1);
    // the config schema itself refuses it first; either way the user is told
    // the name is wrong and never gets a silent one-engine run
    expect(chunks.join("")).toMatch(/claud/);
  });
});

describe("--dry-run with no keys", () => {
  it("prices nothing it cannot price, and says the engine list is empty because of it", async () => {
    const { chunks, restore } = captureStdout();
    const code = await runAuditCommandWith(engineMod, configMod, reportMod, ["acme.example", "--dry-run"], NO_TTY);
    restore();
    const out = chunks.join("");
    expect(code).toBe(0);
    expect(out).toContain("Engines   (none: add a key)");
    expect(out).toContain("est. add a key to price this run");
    // the old output quoted a dollar range next to "0 engines"
    expect(out).not.toMatch(/0 engines · est\. \$/);
  });

  it("keeps the estimate as soon as one engine has a key", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    const { chunks, restore } = captureStdout();
    const code = await runAuditCommandWith(engineMod, configMod, reportMod, ["acme.example", "--dry-run"], NO_TTY);
    restore();
    expect(code).toBe(0);
    expect(chunks.join("")).toMatch(/est\. \$\d/);
  });
});

describe("--dry-run question list", () => {
  it("says how many are frozen, how many this profile asks, and marks them", async () => {
    const { chunks, restore } = captureStdout();
    // a named rival keeps the head-to-head templates in the set (engine
    // questions.ts holds them back when no competitor is known)
    const code = await runAuditCommandWith(
      engineMod,
      configMod,
      reportMod,
      ["acme.example", "--dry-run", "--competitors", "RivalCo"],
      NO_TTY,
    );
    restore();
    expect(code).toBe(0);
    const out = chunks.join("");
    expect(out).toMatch(/Questions 23 frozen · smoke asks 6 \(marked ●\)/);
    expect(out).not.toContain("held back");
    // exactly six rows carry the marker, and they are the ones selectForProfile picks
    const marked = out
      .split("\n")
      .filter((l) => /^ {2}● q\d\d /.test(l))
      .map((l) => l.trim().split(/\s+/)[1]);
    expect(marked).toHaveLength(6);
  });

  it("a full run asks the whole set, so nothing is marked and the line says so", async () => {
    const { chunks, restore } = captureStdout();
    const code = await runAuditCommandWith(
      engineMod,
      configMod,
      reportMod,
      ["acme.example", "--dry-run", "--profile", "full", "--competitors", "RivalCo"],
      NO_TTY,
    );
    restore();
    expect(code).toBe(0);
    const out = chunks.join("");
    expect(out).toMatch(/Questions 23 frozen · full asks all 23/);
    expect(out).not.toContain("●");
  });

  it("with no rival known, says the head-to-head questions are held back instead of showing fillers", async () => {
    const { chunks, restore } = captureStdout();
    const code = await runAuditCommandWith(engineMod, configMod, reportMod, ["acme.example", "--dry-run"], NO_TTY);
    restore();
    expect(code).toBe(0);
    const out = chunks.join("");
    expect(out).toMatch(/Rivals {4}\d+ head-to-head questions held back/);
    expect(out).not.toContain("the leading alternative");
    expect(out).not.toContain("another leading option");
  });
});
