// The four MCP tools, with ZERO network and ZERO LLM spend: gate_check runs
// the real crawl/domain-check logic against a fake Fetcher, read_report runs
// against the shipped Kestrel example bundle, and audit runs the real
// pipeline over the fake ask/llm/fetcher seam (run.test.ts's pattern).
// @saylent/engine and @saylent/report are imported STATICALLY — see run.ts's
// TESTABILITY NOTE for why the tools take injected module objects at all.
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as engineMod from "@saylent/engine";
import type { AskFn, Fetcher } from "@saylent/engine";
import { loadConfig, mergeConfig } from "@saylent/engine/config";
import * as reportRenderMod from "@saylent/report/render";
import { buildBrief } from "@saylent/report/brief";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// A relative path, not the "@saylent/report/render/from-bundle" alias, which
// crashes this TypeScript version — see engine-loader.ts's note.
import { reportDataFromBundle } from "../../../report/src/render/from-bundle";
import type { PipelineDeps, ReportModules } from "../run";
import {
  auditTool,
  gateCheckTool,
  readReportTool,
  verifyTool,
  type DryRunResult,
  type McpToolDeps,
  type RunToolResult,
} from "./tools";

const reportMod: ReportModules = {
  reportDataFromBundle,
  renderReportHtml: reportRenderMod.renderReportHtml,
  renderMarkdown: reportRenderMod.renderMarkdown,
  renderMovementHtml: reportRenderMod.renderMovementHtml,
};

const here = path.dirname(fileURLToPath(import.meta.url));
const KESTREL_BUNDLE = path.resolve(here, "../../../../examples/kestrel/run.json");

// ---------------------------------------------------------------------------
// fakes
// ---------------------------------------------------------------------------

const ROBOTS = ["User-agent: GPTBot", "Disallow: /", "", "User-agent: ClaudeBot", "Allow: /"].join("\n");
const HOME_HTML =
  `<!doctype html><html><head><title>Acme</title>` +
  `<script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script></head>` +
  `<body><main><h1>Acme Cloud</h1><p>${"edge CDN for platform teams. ".repeat(10)}</p></main></body></html>`;

const gateFetcher: Fetcher = async (url, opts) => {
  if (url.endsWith("/robots.txt")) return { status: 200, finalUrl: url, text: ROBOTS };
  if (url.endsWith(".xml")) return { status: 404, finalUrl: url, text: "" };
  if (opts?.ua?.includes("ClaudeBot")) return { status: 403, finalUrl: url, text: "blocked" };
  return { status: 200, finalUrl: url, text: HOME_HTML };
};

const auditPage = (title: string) =>
  `<!doctype html><html><head><title>${title}</title>` +
  `<meta name="robots" content="index,follow"></head><body><main><h1>${title}</h1>` +
  `<p>${Array.from({ length: 60 }, (_, i) => `Acme Cloud runs an edge network in ${20 + i} regions for platform teams.`).join(" ")}</p>` +
  `<a href="/pricing">Pricing</a><a href="/docs">Docs</a></main></body></html>`;

const auditFetcher: Fetcher = async (url) => {
  if (url.endsWith("/robots.txt")) return { status: 200, finalUrl: url, text: "User-agent: *\nAllow: /\n" };
  if (url.endsWith(".xml")) return { status: 404, finalUrl: url, text: "" };
  return { status: 200, finalUrl: url, text: auditPage(new URL(url).pathname) };
};

const fakeAsk: AskFn = async () => ({
  ok: true,
  text: "Acme Cloud is the one to beat for platform teams. Globex is cheaper at low volume.",
  citations: [{ url: "https://acme.example/pricing", title: "Acme Cloud pricing" }],
  usage: { input_tokens: 1000, output_tokens: 200, searches: 1 },
});

const fakeLlm: PipelineDeps["llm"] = {
  brandModel: async () =>
    JSON.stringify({
      aliases: ["Acme Cloud"],
      category: "edge CDN",
      icp: "platform teams",
      products: ["Edge CDN"],
      value_props: ["global cache"],
      problems: ["slow global page loads"],
      competitors: ["Globex"],
      language: "en",
      confidence: "ok",
    }),
  drafter: async () => "## Draft\n\nA short page about edge caching for platform teams.",
  judge: async () =>
    JSON.stringify({
      mention_type: "recommended",
      prominence: "first",
      sentiment: "positive",
      claims: [{ text: "runs an edge network in 20 regions", kind: "neutral_fact" }],
      other_brands: [{ name: "Globex", why: "cheaper at low volume" }],
      excerpt: "",
    }),
};

function deps(overrides: Partial<McpToolDeps> = {}): McpToolDeps {
  return {
    run: async () => ({
      engineMod,
      configMod: { loadConfig, mergeConfig },
      reportMod,
      reportDataFromBundle,
      buildBrief,
    }),
    gate: async () => engineMod,
    bundle: async () => ({ readBundle: engineMod.readBundle, reportDataFromBundle, buildBrief }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isolation: a fake HOME (no real ~/.saylent config or spend ledger) and no
// inherited provider keys.
// ---------------------------------------------------------------------------

let home: string;
let cwd: string;
let prevHome: string | undefined;
const prevEnv: Record<string, string | undefined> = {};
const KEY_VARS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "PERPLEXITY_API_KEY"];

beforeEach(() => {
  prevHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "saylent-mcp-home-"));
  cwd = mkdtempSync(path.join(tmpdir(), "saylent-mcp-cwd-"));
  process.env.HOME = home;
  for (const k of KEY_VARS) {
    prevEnv[k] = process.env[k];
    delete process.env[k];
  }
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

// ---------------------------------------------------------------------------
// gate_check ($0)
// ---------------------------------------------------------------------------

describe("gate_check tool (real engine logic, fake fetcher, $0)", () => {
  it("returns the CLI's own block plus the structured result and exit code", async () => {
    const result = await gateCheckTool(deps({ fetcher: gateFetcher }), { domain: "acme.example" });
    expect(result.cost_usd).toBe(0);
    expect(result.domain).toBe("acme.example");
    expect(result.report).toContain("robots.txt");
    expect(result.report).toContain("live probe");
    expect(result.report).toContain("JSON-LD");
    // robots.txt allows ClaudeBot but the live probe 403s: the access_blocked
    // finding, which is a failing check.
    expect(result.report).toMatch(/ClaudeBot 403/);
    expect(result.result).toBe("FAIL");
    expect(result.exit_code).toBe(1);
  });

  it("needs no provider key at all", async () => {
    const result = await gateCheckTool(deps({ fetcher: gateFetcher }), { domain: "acme.example" });
    expect(result.report.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// read_report ($0)
// ---------------------------------------------------------------------------

describe("read_report tool (the shipped Kestrel bundle, $0)", () => {
  it("returns the Brief blocks as JSON with the run's identity", async () => {
    const result = await readReportTool(deps(), { bundle_path: KESTREL_BUNDLE });
    expect(result.cost_usd).toBe(0);
    expect(result.domain.length).toBeGreaterThan(0);
    const brief = result.summary_blocks as { hero: { headline: string }; cards: { id: string; blocks: unknown[] }[] };
    expect(brief.hero.headline.length).toBeGreaterThan(0);
    expect(brief.cards.length).toBeGreaterThan(0);
    expect(brief.cards[0].blocks.length).toBeGreaterThan(0);
    expect(result.sections).toContain("hero");
    expect(result.sections).toContain(brief.cards[0].id);
  });

  it("accepts the run DIRECTORY, not only the run.json path", async () => {
    const result = await readReportTool(deps(), { bundle_path: path.dirname(KESTREL_BUNDLE) });
    expect(result.bundle_path).toBe(KESTREL_BUNDLE);
  });

  it("returns just one named section when asked", async () => {
    const whole = await readReportTool(deps(), { bundle_path: KESTREL_BUNDLE });
    const cardId = (whole.summary_blocks as { cards: { id: string }[] }).cards[0].id;
    const one = await readReportTool(deps(), { bundle_path: KESTREL_BUNDLE, section: cardId });
    expect((one.summary_blocks as { id: string }).id).toBe(cardId);
  });

  it("names the sections it does have when the section is unknown", async () => {
    await expect(readReportTool(deps(), { bundle_path: KESTREL_BUNDLE, section: "nope" })).rejects.toThrow(
      /Available sections/,
    );
  });

  it('section: "questions" returns the run\'s frozen question set', async () => {
    const result = await readReportTool(deps(), { bundle_path: KESTREL_BUNDLE, section: "questions" });
    expect(result.sections).toContain("questions");
    const questions = result.summary_blocks as { text: string }[];
    expect(Array.isArray(questions)).toBe(true);
    expect(questions.length).toBeGreaterThan(0);
    expect(questions[0].text.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// audit — keys and the spend cap, both BEFORE any provider call
// ---------------------------------------------------------------------------

describe("audit tool", () => {
  it("refuses without keys, with the CLI's own three-ways message", async () => {
    let pipelineTouched = false;
    const pipeline: PipelineDeps = {
      ask: async () => {
        pipelineTouched = true;
        return { ok: true, text: "", citations: [] };
      },
      llm: fakeLlm,
      fetcher: auditFetcher,
    };
    await expect(auditTool(deps({ cwd, pipeline }), { domain: "acme.example" })).rejects.toThrow(/OPENAI_API_KEY/);
    expect(pipelineTouched).toBe(false);
  });

  it("never accepts a key as an argument (there is no such parameter)", async () => {
    // the arg object is typed, but an agent can still send extra JSON — it
    // must not become a key by any route.
    const args = { domain: "acme.example", openai_key: "sk-should-be-ignored" } as unknown as { domain: string };
    await expect(auditTool(deps({ cwd }), args)).rejects.toThrow(/OPENAI_API_KEY/);
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
  });

  it("refuses when max_usd is below the high estimate, before the pipeline runs", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    let pipelineTouched = false;
    const pipeline: PipelineDeps = {
      ask: async () => {
        pipelineTouched = true;
        return { ok: true, text: "", citations: [] };
      },
      llm: fakeLlm,
      fetcher: auditFetcher,
    };
    await expect(
      auditTool(deps({ cwd, pipeline }), { domain: "acme.example", max_usd: 0.01, out_dir: cwd }),
    ).rejects.toThrow(/max-usd/);
    expect(pipelineTouched).toBe(false);
  });

  it("runs and returns verdict, band, Brief blocks, file paths and the real cost when max_usd allows it", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const logs: string[] = [];
    const result = (await auditTool(
      deps({
        cwd,
        log: (m) => logs.push(m),
        pipeline: { ask: fakeAsk, llm: fakeLlm, fetcher: auditFetcher },
      }),
      { domain: "acme.example", brand: "Acme Cloud", profile: "smoke", max_usd: 100, out_dir: cwd },
    )) as RunToolResult;

    expect(result.verdict).toMatch(/of \d+ answers/);
    expect(result.band).toMatch(/recommended/);
    expect(typeof result.cost_usd).toBe("number");
    expect(result.report_paths.run_json).toContain("run.json");
    expect(result.report_paths.report_html).toContain("report.html");
    expect(result.report_paths.report_md).toContain("report.md");
    const brief = result.summary_blocks as { hero: { headline: string }; cards: unknown[] };
    expect(brief.hero.headline.length).toBeGreaterThan(0);
    expect(brief.cards.length).toBeGreaterThan(0);
    // long runs narrate themselves (these become MCP log notifications)
    expect(logs.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // The full AuditOptions surface: dry_run,
  // competitors/engines/skip/models, inline `questions`.
  // -------------------------------------------------------------------------

  it("dry_run: true returns the question set + estimate at $0, no keys required", async () => {
    const result = (await auditTool(deps({ cwd }), { domain: "acme.example", dry_run: true })) as DryRunResult;
    expect(result.dry_run).toBe(true);
    expect(result.cost_usd).toBe(0);
    expect(result.question_set.source).toBe("template defaults");
    expect(result.question_set.count).toBeGreaterThan(0);
    expect(result.question_set.questions[0].text.length).toBeGreaterThan(0);
    expect(result.estimate_usd.low).toBeGreaterThanOrEqual(0);
    expect(result.estimate_usd.high).toBeGreaterThan(0);
  });

  it("dry_run reuses inline `questions` instead of template defaults", async () => {
    const result = (await auditTool(deps({ cwd }), {
      domain: "acme.example",
      dry_run: true,
      questions: [{ type: "category", text: "What is the best edge CDN for platform teams?" }],
    })) as DryRunResult;
    expect(result.question_set.source).toBe("questions_file/questions");
    expect(result.question_set.count).toBe(1);
    expect(result.question_set.questions[0].text).toBe("What is the best edge CDN for platform teams?");
    expect(result.question_set.questions[0].scored).toBe(true);
  });

  it("`skip: [\"drafts\"]` skips the drafter role, same as `--skip drafts`", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    let draftCalls = 0;
    const llm: PipelineDeps["llm"] = {
      brandModel: fakeLlm.brandModel,
      judge: fakeLlm.judge,
      drafter: async (...a: Parameters<typeof fakeLlm.drafter>) => {
        draftCalls += 1;
        return fakeLlm.drafter(...a);
      },
    };
    const result = (await auditTool(deps({ cwd, pipeline: { ask: fakeAsk, llm, fetcher: auditFetcher } }), {
      domain: "acme.example",
      out_dir: cwd,
      max_usd: 100,
      skip: ["drafts"],
    })) as RunToolResult;
    expect(draftCalls).toBe(0);
    expect(typeof result.cost_usd).toBe("number");
  });

  it("`competitors`/`engines` narrow the run to what was asked", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    // engines.ts's ENGINE_FLOOR: a single-engine selection falls back to all
    // four (a one-engine audit isn't a meaningful cross-family verdict), so
    // this asks for two — the narrowest set that actually narrows.
    const result = (await auditTool(deps({ cwd, pipeline: { ask: fakeAsk, llm: fakeLlm, fetcher: auditFetcher } }), {
      domain: "acme.example",
      out_dir: cwd,
      max_usd: 100,
      engines: ["chatgpt", "claude"],
      competitors: ["Globex"],
    })) as RunToolResult;
    const bundle = JSON.parse(readFileSync(result.report_paths.run_json, "utf8")) as {
      run: { engines: string[] };
    };
    expect(bundle.run.engines).toEqual(["chatgpt", "claude"]);
  });

  it("inline `questions` rows are used instead of a generated set", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const result = (await auditTool(deps({ cwd, pipeline: { ask: fakeAsk, llm: fakeLlm, fetcher: auditFetcher } }), {
      domain: "acme.example",
      out_dir: cwd,
      max_usd: 100,
      questions: [{ type: "category", text: "What is the best edge CDN for platform teams?" }],
    })) as RunToolResult;
    const bundle = JSON.parse(readFileSync(result.report_paths.run_json, "utf8")) as {
      questions: { text: string }[];
    };
    expect(bundle.questions).toHaveLength(1);
    expect(bundle.questions[0].text).toBe("What is the best edge CDN for platform teams?");
  });

  it("an ambiguous `judge` with no `judge_family` refuses clearly, before any spend", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    await expect(
      auditTool(deps({ cwd, pipeline: { ask: fakeAsk, llm: fakeLlm, fetcher: auditFetcher } }), {
        domain: "acme.example",
        out_dir: cwd,
        judge: "mystery-model",
      }),
    ).rejects.toThrow(/cannot tell which provider/);
  });
});

// ---------------------------------------------------------------------------
// The MCP-only guards. An MCP tool argument is chosen by a
// model from text it read somewhere, so three things the CLI happily accepts
// are refused here unless the operator opted in by environment variable.
// ---------------------------------------------------------------------------
const MCP_ENV_VARS = [
  "SAYLENT_MCP_ALLOW_PRIVATE",
  "SAYLENT_MCP_ALLOW_ANY_OUT_DIR",
  "SAYLENT_MCP_ALLOW_EXEC_CONFIG",
];

describe("MCP safety guards", () => {
  const prevMcpEnv: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of MCP_ENV_VARS) {
      prevMcpEnv[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(prevMcpEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  // -------------------------------------------------------------------------
  // #5 allow_private
  // -------------------------------------------------------------------------
  it("#5 audit refuses allow_private, naming the variable that would enable it", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    let pipelineTouched = false;
    const pipeline: PipelineDeps = {
      ask: async () => {
        pipelineTouched = true;
        return { ok: true, text: "", citations: [] };
      },
      llm: fakeLlm,
      fetcher: auditFetcher,
    };
    await expect(
      auditTool(deps({ cwd, pipeline }), {
        domain: "169.254.169.254",
        out_dir: cwd,
        max_usd: 100,
        allow_private: true,
      }),
    ).rejects.toThrow(/SAYLENT_MCP_ALLOW_PRIVATE=1/);
    expect(pipelineTouched).toBe(false);
  });

  it("#5 verify refuses allow_private too, before it reads the baseline", async () => {
    await expect(
      verifyTool(deps({ cwd }), { bundle_path: "/nope/run.json", allow_private: true }),
    ).rejects.toThrow(/SAYLENT_MCP_ALLOW_PRIVATE=1/);
  });

  it("#5 SAYLENT_MCP_ALLOW_PRIVATE=1 lets the operator opt back in", async () => {
    process.env.SAYLENT_MCP_ALLOW_PRIVATE = "1";
    // no keys configured, so it now falls through to the NEXT refusal —
    // which proves the allow_private gate itself no longer fires.
    await expect(
      auditTool(deps({ cwd }), { domain: "acme.example", out_dir: cwd, allow_private: true }),
    ).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it("#5 an audit without allow_private is untouched", async () => {
    const result = (await auditTool(deps({ cwd }), { domain: "acme.example", dry_run: true })) as DryRunResult;
    expect(result.dry_run).toBe(true);
  });

  // -------------------------------------------------------------------------
  // #11 out_dir
  // -------------------------------------------------------------------------
  it("#11 refuses an out_dir that escapes the server's cwd", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    let pipelineTouched = false;
    const pipeline: PipelineDeps = {
      ask: async () => {
        pipelineTouched = true;
        return { ok: true, text: "", citations: [] };
      },
      llm: fakeLlm,
      fetcher: auditFetcher,
    };
    for (const out of ["../escape", path.join(tmpdir(), "saylent-escape-abs"), "a/../../escape"]) {
      await expect(
        auditTool(deps({ cwd, pipeline }), { domain: "acme.example", out_dir: out, max_usd: 100 }),
      ).rejects.toThrow(/resolves outside this server's working directory/);
    }
    expect(pipelineTouched).toBe(false);
  });

  it("#11 refuses an out_dir that reaches outside through a SYMLINK", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const outside = mkdtempSync(path.join(tmpdir(), "saylent-outside-"));
    try {
      symlinkSync(outside, path.join(cwd, "link"), "dir");
    } catch {
      return; // symlinks unavailable (e.g. Windows without privilege) — skip
    }
    try {
      await expect(
        auditTool(deps({ cwd }), { domain: "acme.example", out_dir: "link/runs", max_usd: 100 }),
      ).rejects.toThrow(/resolves outside this server's working directory/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("#11 accepts an out_dir inside the cwd, and the default relative one", async () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const result = (await auditTool(deps({ cwd, pipeline: { ask: fakeAsk, llm: fakeLlm, fetcher: auditFetcher } }), {
      domain: "acme.example",
      out_dir: "runs/today",
      max_usd: 100,
    })) as RunToolResult;
    expect(result.report_paths.run_json.startsWith(path.join(cwd, "runs", "today"))).toBe(true);
  }, 90000);

  it("#11 SAYLENT_MCP_ALLOW_ANY_OUT_DIR=1 lets the operator opt back in", async () => {
    process.env.SAYLENT_MCP_ALLOW_ANY_OUT_DIR = "1";
    // no keys: the out_dir gate is passed, the keys refusal is what surfaces.
    await expect(
      auditTool(deps({ cwd }), { domain: "acme.example", out_dir: path.join(tmpdir(), "anywhere") }),
    ).rejects.toThrow(/OPENAI_API_KEY/);
  });

  // -------------------------------------------------------------------------
  // #12 executable config
  // -------------------------------------------------------------------------
  it("#12 ignores an executable saylent.config.js and logs why", async () => {
    // a config that would be OBEYED by the CLI: it renames the profile. If the
    // MCP path executed it, the dry run below would report profile "full".
    writeFileSync(
      path.join(cwd, "saylent.config.js"),
      'export default { profile: "full", competitors: ["executed.example"] };\n',
      "utf8",
    );
    const logs: string[] = [];
    const result = (await auditTool(deps({ cwd, log: (m) => logs.push(m) }), {
      domain: "acme.example",
      dry_run: true,
    })) as DryRunResult;
    expect(result.profile).toBe("smoke"); // the shipped default, not the file's "full"
    expect(logs.join("\n")).toMatch(/ignored .*saylent\.config\.js/);
    expect(logs.join("\n")).toMatch(/SAYLENT_MCP_ALLOW_EXEC_CONFIG=1/);
  });

  it("#12 still reads saylent.config.json", async () => {
    writeFileSync(path.join(cwd, "saylent.config.json"), JSON.stringify({ profile: "full" }), "utf8");
    const result = (await auditTool(deps({ cwd }), { domain: "acme.example", dry_run: true })) as DryRunResult;
    expect(result.profile).toBe("full");
  });

  it("#12 SAYLENT_MCP_ALLOW_EXEC_CONFIG=1 lets the operator opt back in", async () => {
    process.env.SAYLENT_MCP_ALLOW_EXEC_CONFIG = "1";
    writeFileSync(path.join(cwd, "saylent.config.mjs"), 'export default { profile: "full" };\n', "utf8");
    const result = (await auditTool(deps({ cwd }), { domain: "acme.example", dry_run: true })) as DryRunResult;
    expect(result.profile).toBe("full");
  });
});
