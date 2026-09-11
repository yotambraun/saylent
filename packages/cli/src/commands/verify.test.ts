// verify command: the template-set refusal guard (questions.ts
// TEMPLATE_SET_VERSION / config.ts questionTemplates) and --judge/--model
// flag wiring. @saylent/engine and @saylent/report are imported STATICALLY
// — see run.test.ts's TESTABILITY NOTE (a dynamic import() of either package
// was measured to hang under vitest).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as engineMod from "@saylent/engine";
import type { SaylentConfig } from "@saylent/engine/config";
import * as reportRenderMod from "@saylent/report/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportDataFromBundle } from "../../../report/src/render/from-bundle";
import type { AskFn } from "@saylent/engine";
import type { ReportModules } from "../run";
import { runAuditToFilesWith } from "../run";
import { runVerifyCommandWith } from "./verify";

const reportMod: ReportModules = {
  reportDataFromBundle,
  renderReportHtml: reportRenderMod.renderReportHtml,
  renderMarkdown: reportRenderMod.renderMarkdown,
  renderMovementHtml: reportRenderMod.renderMovementHtml,
};

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), "saylent-verify-cmd-"));
  dirs.push(d);
  return d;
}

let home: string;
let cwd: string;
let prevHome: string | undefined;
const prevEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  prevHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "saylent-verify-home-"));
  cwd = mkdtempSync(path.join(tmpdir(), "saylent-verify-cwd-"));
  process.env.HOME = home;
  for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "PERPLEXITY_API_KEY"]) {
    prevEnv[k] = process.env[k];
  }
  process.env.OPENAI_API_KEY = "sk-test-openai";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  delete process.env.GEMINI_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
});

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(cwd, { recursive: true, force: true });
  process.env.HOME = prevHome;
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

const page = (title: string) =>
  `<!doctype html><html><head><title>${title}</title>` +
  `<meta name="robots" content="index,follow"></head><body><main><h1>${title}</h1>` +
  `<p>${Array.from({ length: 60 }, (_, i) => `Acme Cloud runs an edge network in ${20 + i} regions for platform teams.`).join(" ")}</p>` +
  `<a href="/pricing">Pricing</a><a href="/docs">Docs</a><a href="/about">About</a></main></body></html>`;

const fakeFetcher = async (url: string) => {
  if (url.endsWith("/robots.txt")) return { status: 200, finalUrl: url, text: "User-agent: *\nAllow: /\n" };
  if (url.endsWith(".xml")) return { status: 404, finalUrl: url, text: "" };
  return { status: 200, finalUrl: url, text: page(new URL(url).pathname) };
};

const BRAND_MODEL_JSON = JSON.stringify({
  aliases: ["Acme Cloud", "Acme"],
  category: "edge CDN",
  icp: "platform teams at growing SaaS companies",
  products: ["Edge CDN", "Edge WAF"],
  value_props: ["global cache", "instant purge"],
  problems: ["slow global page loads", "origin overload"],
  competitors: ["Globex", "Initech"],
  language: "en",
  confidence: "ok",
});

const JUDGE_JSON = JSON.stringify({
  mention_type: "recommended",
  prominence: "first",
  sentiment: "positive",
  claims: [{ text: "runs an edge network in 20 regions", kind: "neutral_fact" }],
  other_brands: [{ name: "Globex", why: "cheaper at low volume" }],
  excerpt: "",
});

function makeFakeAsk(): { ask: AskFn } {
  const ask: AskFn = async () => ({
    ok: true,
    text: "Acme Cloud is the one to beat for platform teams.",
    citations: [{ url: "https://reviews.example/best-edge-cdn", title: "Best edge CDN" }],
    usage: { input_tokens: 1000, output_tokens: 200, searches: 1 },
  });
  return { ask };
}

function makeFakeLlm() {
  return {
    brandModel: async () => BRAND_MODEL_JSON,
    drafter: async () => "## Draft\n\nA short, concrete page about edge caching for platform teams.",
    judge: async () => JUDGE_JSON,
  };
}

async function makeBaseline(): Promise<string> {
  const baseDir = tempDir();
  const { ask } = makeFakeAsk();
  const { runJsonPath } = await runAuditToFilesWith(
    engineMod,
    reportMod,
    {
      runId: "run_test_verify_cmd_baseline",
      brandName: "Acme Cloud",
      domain: "acme.example",
      competitors: ["Globex"],
      profile: "smoke",
      engines: ["chatgpt", "claude"],
      keys: {},
      deps: { ask, llm: makeFakeLlm(), fetcher: fakeFetcher },
    },
    baseDir,
  );
  return runJsonPath!;
}

function configMod(config: SaylentConfig) {
  return { loadConfig: async () => ({ config, source: null }) };
}

function captureStdout(): { chunks: string[]; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
    chunks.push(String(c));
    return true;
  });
  return { chunks, restore: () => spy.mockRestore() };
}
function captureStderr(): { chunks: string[]; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
    chunks.push(String(c));
    return true;
  });
  return { chunks, restore: () => spy.mockRestore() };
}

describe("runVerifyCommandWith — template-set refusal (questionTemplates version bump)", () => {
  it("refuses when saylent.config questionTemplates would generate a different template set", async () => {
    const baselinePath = await makeBaseline();
    const { chunks, restore } = captureStderr();
    const code = await runVerifyCommandWith(
      engineMod,
      configMod({ questionTemplates: { trust: { templates: ["Can I trust {brand}?"] } } }),
      reportMod,
      [baselinePath, "--yes"],
      { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
    );
    restore();
    expect(code).toBe(1);
    const err = chunks.join("");
    expect(err).toContain("Refused");
    expect(err).toContain("2+custom");
  }, 90000);

  // Neither test below reaches the real pipeline (no fakes are wired through
  // runVerifyCommandWith — it has no deps-injection point, by design, same as
  // audit.ts). --max-usd 0 refuses BEFORE the pipeline runs, exactly the
  // pattern audit.test.ts uses to prove a code path is REACHED without
  // spending anything.
  it("passes the template-set guard when the config matches the baseline (refuses later, on --max-usd, not on 'Refused')", async () => {
    const baselinePath = await makeBaseline();
    const { chunks, restore } = captureStderr();
    const code = await runVerifyCommandWith(
      engineMod,
      configMod({}),
      reportMod,
      [baselinePath, "--yes", "--max-usd", "0"],
      { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
    );
    restore();
    expect(code).toBe(1);
    const err = chunks.join("");
    expect(err).toContain("--max-usd");
    expect(err).not.toContain("Refused");
  }, 90000);
});

// Samples feature: the baseline was frozen under
// smoke's own profile default (1x, no tiebreak) — a resolved default that has
// since drifted (AUDIT_SAMPLES / saylent.config sampling) must be refused
// unless the operator explicitly says --samples, same reasoning + shape as
// the template-set guard above.
describe("runVerifyCommandWith — Samples guard (resolved default drifted from the baseline)", () => {
  it("refuses when AUDIT_SAMPLES now resolves to a different count than the baseline was frozen with", async () => {
    const baselinePath = await makeBaseline(); // smoke profile → frozen at 1x
    const prev = process.env.AUDIT_SAMPLES;
    process.env.AUDIT_SAMPLES = "3";
    try {
      const { chunks, restore } = captureStderr();
      const code = await runVerifyCommandWith(
        engineMod,
        configMod({}),
        reportMod,
        [baselinePath, "--yes"],
        { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
      );
      restore();
      expect(code).toBe(1);
      const err = chunks.join("");
      expect(err).toContain("Refused");
      expect(err).toContain("frozen with 1x");
      expect(err).toContain("resolves to 3x");
      expect(err).toContain("--samples");
    } finally {
      if (prev === undefined) delete process.env.AUDIT_SAMPLES;
      else process.env.AUDIT_SAMPLES = prev;
    }
  }, 90000);

  it("passing --samples explicitly silences the guard (proceeds past it, stopped later by --max-usd 0, not by 'Refused')", async () => {
    const baselinePath = await makeBaseline();
    const prev = process.env.AUDIT_SAMPLES;
    process.env.AUDIT_SAMPLES = "3";
    try {
      const { chunks, restore } = captureStderr();
      const code = await runVerifyCommandWith(
        engineMod,
        configMod({}),
        reportMod,
        [baselinePath, "--yes", "--samples", "3", "--max-usd", "0"],
        { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
      );
      restore();
      expect(code).toBe(1);
      const err = chunks.join("");
      expect(err).toContain("--max-usd");
      expect(err).not.toContain("Refused");
    } finally {
      if (prev === undefined) delete process.env.AUDIT_SAMPLES;
      else process.env.AUDIT_SAMPLES = prev;
    }
  }, 90000);

  it("no drift, no env/config override: passes the guard silently", async () => {
    const baselinePath = await makeBaseline();
    const { chunks, restore } = captureStderr();
    const code = await runVerifyCommandWith(
      engineMod,
      configMod({}),
      reportMod,
      [baselinePath, "--yes", "--max-usd", "0"],
      { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
    );
    restore();
    expect(code).toBe(1); // stopped by --max-usd 0
    expect(chunks.join("")).not.toContain("Refused");
  }, 90000);
});

// --skip is accepted for parity but has no
// effect on verify (drafts/corpus/gates are audit-only stages regardless).
describe("runVerifyCommandWith — --skip (parity, no effect)", () => {
  it("prints the no-effect note and still proceeds to the (later) --max-usd stop", async () => {
    const baselinePath = await makeBaseline();
    const { chunks, restore } = captureStdout();
    const code = await runVerifyCommandWith(
      engineMod,
      configMod({}),
      reportMod,
      [baselinePath, "--yes", "--max-usd", "0", "--skip", "drafts,corpus,gates"],
      { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
    );
    restore();
    expect(code).toBe(1); // stopped by --max-usd 0, AFTER the preflight printed
    expect(chunks.join("")).toContain("no effect here");
  }, 90000);

  it("an unrecognized --skip stage name errors clearly", async () => {
    const baselinePath = await makeBaseline();
    const { chunks, restore } = captureStderr();
    const code = await runVerifyCommandWith(
      engineMod,
      configMod({}),
      reportMod,
      [baselinePath, "--yes", "--skip", "bogus"],
      { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
    );
    restore();
    expect(code).toBe(1);
    expect(chunks.join("")).toMatch(/--skip bogus/);
  }, 90000);
});

describe("runVerifyCommandWith — --judge / --model flag wiring", () => {
  it("prints the resolved judge model(s) in the preflight, honoring --judge", async () => {
    const baselinePath = await makeBaseline();
    const { chunks, restore } = captureStdout();
    const code = await runVerifyCommandWith(
      engineMod,
      configMod({}),
      reportMod,
      [baselinePath, "--yes", "--max-usd", "0", "--judge", "claude-custom-judge", "--judge-family", "anthropic"],
      { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
    );
    restore();
    expect(code).toBe(1); // stopped by --max-usd 0, AFTER the preflight printed
    expect(chunks.join("")).toContain("claude-custom-judge");
  }, 90000);

  it("an ambiguous --judge model without --judge-family is refused with a clear error", async () => {
    const baselinePath = await makeBaseline();
    const { chunks, restore } = captureStderr();
    const code = await runVerifyCommandWith(
      engineMod,
      configMod({}),
      reportMod,
      [baselinePath, "--yes", "--judge", "mystery-model"],
      { stdinIsTTY: false, promptKeysIo: { input: process.stdin, output: process.stdout } },
    );
    restore();
    expect(code).toBe(1);
    expect(chunks.join("")).toMatch(/cannot tell which provider/);
  }, 90000);
});
