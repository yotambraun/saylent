// `saylent questions <domain>` — generates the domain's question set. @saylent/engine is
// imported STATICALLY (see run.test.ts's TESTABILITY NOTE), with safeFetch
// and brandModelCall overridden by fakes on a per-test basis so the
// --brand-model path never touches the real network or a real LLM.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as engineMod from "@saylent/engine";
import { loadConfig } from "@saylent/engine/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runQuestionsCommandWith } from "./questions";

let home: string;
let cwd: string;
let prevHome: string | undefined;
const prevEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  prevHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "saylent-questions-home-"));
  cwd = mkdtempSync(path.join(tmpdir(), "saylent-questions-cwd-"));
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
function captureStderr(): { chunks: string[]; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
    chunks.push(String(c));
    return true;
  });
  return { chunks, restore: () => spy.mockRestore() };
}

const configMod = { loadConfig };

const BRAND_MODEL_JSON = JSON.stringify({
  aliases: ["Acme Cloud", "Acme"],
  category: "edge CDN",
  icp: "platform teams",
  products: ["Edge CDN"],
  value_props: ["global cache"],
  problems: ["slow global page loads"],
  competitors: ["Globex"],
  language: "en",
  confidence: "ok",
});

const PAGE_HTML =
  `<!doctype html><html><head><title>Acme Cloud</title></head><body><main><h1>Acme Cloud</h1>` +
  `<p>${"edge CDN for platform teams. ".repeat(20)}</p></main></body></html>`;

/** engineMod with safeFetch + brandModelCall replaced by fakes — the
 *  --brand-model path (previewQuestions -> crawlSite -> engineMod.safeFetch,
 *  buildBrandModel -> engineMod.brandModelCall) never touches the network or
 *  a real LLM. --no-brand-model never calls either. */
function fakedEngineMod() {
  return {
    ...engineMod,
    safeFetch: (async (url: string) => {
      if (url.endsWith("/robots.txt")) return { status: 404, finalUrl: url, text: "" };
      return { status: 200, finalUrl: url, text: PAGE_HTML };
    }) as typeof engineMod.safeFetch,
    brandModelCall: (async () => BRAND_MODEL_JSON) as typeof engineMod.brandModelCall,
  };
}

describe("runQuestionsCommandWith", () => {
  it("--help prints usage and exits 0", async () => {
    const { chunks, restore } = captureStdout();
    const code = await runQuestionsCommandWith(fakedEngineMod(), configMod, ["--help"]);
    restore();
    expect(code).toBe(0);
    expect(chunks.join("")).toContain("saylent questions <domain>");
  });

  it("missing <domain> errors with exit 1", async () => {
    const { chunks, restore } = captureStderr();
    const code = await runQuestionsCommandWith(fakedEngineMod(), configMod, []);
    restore();
    expect(code).toBe(1);
    expect(chunks.join("")).toContain("Missing <domain>");
  });

  it("--no-brand-model: $0, no keys needed, prints questions and writes questions.json", async () => {
    const { chunks, restore } = captureStdout();
    const code = await runQuestionsCommandWith(fakedEngineMod(), configMod, [
      "acme.example",
      "--no-brand-model",
      "--yes",
    ]);
    restore();
    expect(code).toBe(0);
    const out = chunks.join("");
    expect(out).toContain("$0");
    expect(out).toContain("template defaults");
    expect(out).toMatch(/\d+ questions/);

    const outFile = path.join(cwd, "questions.json");
    expect(existsSync(outFile)).toBe(true);
    const json = JSON.parse(readFileSync(outFile, "utf8"));
    expect(json.brand).toBe("acme.example");
    expect(json.domain).toBe("acme.example");
    expect(Array.isArray(json.questions)).toBe(true);
    expect(json.questions.length).toBeGreaterThan(0);
    expect(json.questions[0]).toHaveProperty("id");
    expect(json.questions[0]).toHaveProperty("type");
    expect(json.questions[0]).toHaveProperty("text");
  });

  it("--print writes no file", async () => {
    const { restore } = captureStdout();
    const code = await runQuestionsCommandWith(fakedEngineMod(), configMod, [
      "acme.example",
      "--no-brand-model",
      "--print",
      "--yes",
    ]);
    restore();
    expect(code).toBe(0);
    expect(existsSync(path.join(cwd, "questions.json"))).toBe(false);
  });

  it("--out <file> writes to the named path", async () => {
    const { restore } = captureStdout();
    const code = await runQuestionsCommandWith(fakedEngineMod(), configMod, [
      "acme.example",
      "--no-brand-model",
      "--out",
      "custom-questions.json",
      "--yes",
    ]);
    restore();
    expect(code).toBe(0);
    expect(existsSync(path.join(cwd, "custom-questions.json"))).toBe(true);
  });

  it("--competitors flows into the template-default brand model", async () => {
    const { chunks, restore } = captureStdout();
    const code = await runQuestionsCommandWith(fakedEngineMod(), configMod, [
      "acme.example",
      "--no-brand-model",
      "--competitors",
      "Rivalco",
      "--yes",
    ]);
    restore();
    expect(code).toBe(0);
    expect(chunks.join("")).toContain("Rivalco");
  });

  it("without --no-brand-model and no keys, errors and hints at --no-brand-model", async () => {
    const { chunks, restore } = captureStderr();
    const code = await runQuestionsCommandWith(fakedEngineMod(), configMod, ["acme.example"]);
    restore();
    expect(code).toBe(1);
    expect(chunks.join("")).toContain("--no-brand-model");
  });

  it("with keys present, runs the real (faked) brand-model + crawl path and reports its cost", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const { chunks, restore } = captureStdout();
    const code = await runQuestionsCommandWith(fakedEngineMod(), configMod, ["acme.example", "--yes"]);
    restore();
    expect(code).toBe(0);
    const out = chunks.join("");
    expect(out).toContain("$0.02");
    expect(out).not.toContain("template defaults)");
    // "edge CDN" only appears if the real (faked) brand-model JSON was used,
    // not the generic template-default brand model.
    expect(out).toContain("edge CDN");

    const json = JSON.parse(readFileSync(path.join(cwd, "questions.json"), "utf8"));
    // brand name is user input (default: the domain) and always wins over the
    // LLM-derived aliases — buildBrandModel's merge rule (brandModel.ts).
    expect(json.brand).toBe("acme.example");
  }, 20000);

  it("a saylent.config questionTemplates override stamps the printed set version '2+custom'", async () => {
    const configWithOverride = {
      loadConfig: async () => ({
        config: { questionTemplates: { trust: { templates: ["Can I trust {brand}?"] } } },
        source: null,
      }),
    };
    const { chunks, restore } = captureStdout();
    const code = await runQuestionsCommandWith(fakedEngineMod(), configWithOverride, [
      "acme.example",
      "--no-brand-model",
      "--yes",
    ]);
    restore();
    expect(code).toBe(0);
    expect(chunks.join("")).toContain("v2+custom");
  });

  it("prints the honest-band explanation: only category+problem questions are scored", async () => {
    const { chunks, restore } = captureStdout();
    const code = await runQuestionsCommandWith(fakedEngineMod(), configMod, [
      "acme.example",
      "--no-brand-model",
      "--yes",
    ]);
    restore();
    expect(code).toBe(0);
    expect(chunks.join("")).toMatch(/Scored\s+\d+ of \d+ \(category \+ problem only/);
  });

  // Samples feature: defaults in effect, with source.
  describe("Sampling defaults-in-effect line", () => {
    // #10: `questions` used to hardcode the FULL profile and print "2x scored
    // questions (profile default)" while `audit` on the same machine would run
    // smoke at 1x — the same phrase, two numbers, neither naming its profile.
    it("prints the smoke default (audit's default) and names the profile", async () => {
      const { chunks, restore } = captureStdout();
      const code = await runQuestionsCommandWith(fakedEngineMod(), configMod, [
        "acme.example",
        "--no-brand-model",
        "--yes",
      ]);
      restore();
      expect(code).toBe(0);
      const out = chunks.join("");
      expect(out).toMatch(/Sampling\s+1x scored questions \(smoke default\)/);
      expect(out).toMatch(/\d+ questions \(\d+ category/);
    });

    it("honors AUDIT_SAMPLES and names it as the source", async () => {
      const prev = process.env.AUDIT_SAMPLES;
      process.env.AUDIT_SAMPLES = "4";
      try {
        const { chunks, restore } = captureStdout();
        const code = await runQuestionsCommandWith(fakedEngineMod(), configMod, [
          "acme.example",
          "--no-brand-model",
          "--yes",
        ]);
        restore();
        expect(code).toBe(0);
        expect(chunks.join("")).toContain("4x scored questions (AUDIT_SAMPLES)");
      } finally {
        if (prev === undefined) delete process.env.AUDIT_SAMPLES;
        else process.env.AUDIT_SAMPLES = prev;
      }
    });

    it("a saylent.config sampling block is named as the source", async () => {
      const configWithSampling = {
        loadConfig: async () => ({ config: { sampling: { samples: 3 } }, source: null }),
      };
      const { chunks, restore } = captureStdout();
      const code = await runQuestionsCommandWith(fakedEngineMod(), configWithSampling, [
        "acme.example",
        "--no-brand-model",
        "--yes",
      ]);
      restore();
      expect(code).toBe(0);
      expect(chunks.join("")).toContain("3x scored questions (saylent.config sampling)");
    });

    it("an invalid AUDIT_SAMPLES is refused with a clear error", async () => {
      const prev = process.env.AUDIT_SAMPLES;
      process.env.AUDIT_SAMPLES = "9";
      try {
        const { chunks, restore } = captureStderr();
        const code = await runQuestionsCommandWith(fakedEngineMod(), configMod, [
          "acme.example",
          "--no-brand-model",
          "--yes",
        ]);
        restore();
        expect(code).toBe(1);
        expect(chunks.join("")).toMatch(/AUDIT_SAMPLES/);
      } finally {
        if (prev === undefined) delete process.env.AUDIT_SAMPLES;
        else process.env.AUDIT_SAMPLES = prev;
      }
    });
  });
});
