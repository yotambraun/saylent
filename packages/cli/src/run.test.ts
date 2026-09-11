// The full audit + verify pipeline, end to end, with ZERO network and ZERO
// LLM spend: fake adapters, a fake judge/brand/drafter, a fake fetcher over a
// fictional site. @saylent/engine and @saylent/report are imported STATICALLY
// here (like every other test in this repo) rather than through the CLI's
// dynamic engine-loader — see the TESTABILITY NOTE at the top of run.ts for
// why (a dynamic import() of either package was measured to hang under
// vitest specifically; static imports are unaffected and this is exactly
// what the "*With" entry points exist for).
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as engineMod from "@saylent/engine";
import * as reportRenderMod from "@saylent/report/render";
// A relative path, not the "@saylent/report/render/from-bundle" alias: that
// alias (any import of it, static OR dynamic) crashes this TypeScript
// version with an internal Debug Failure — see engine-loader.ts's own note
// on the same bug for the dynamic-import case. tsconfig.json is out of this
// scope, so the workaround lives on this side.
import { reportDataFromBundle } from "../../report/src/render/from-bundle";
import type { AskFn } from "@saylent/engine";
// `failed` is the adapter boundary itself (not re-exported by the barrel) —
// the test below drives the real one, not a copy of its logic.
// relative, not the "@saylent/engine/adapters/shared" alias: that specifier
// resolves through the package exports to packages/engine/dist, so a test of
// engine SOURCE behavior would silently run against the last build.
import { failed } from "../../engine/src/adapters/shared";
import { clearRegisteredSecrets, registerSecret } from "./redact";
import {
  buildCrawlerFetcher,
  buildCrawlerHooks,
  hasEngineFailures,
  runAuditToFilesWith,
  runVerifyToFilesWith,
  type ReportModules,
  type PipelineDeps,
} from "./run";

const reportMod: ReportModules = {
  reportDataFromBundle,
  renderReportHtml: reportRenderMod.renderReportHtml,
  renderMarkdown: reportRenderMod.renderMarkdown,
  renderMovementHtml: reportRenderMod.renderMovementHtml,
};

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), "saylent-cli-run-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const page = (title: string) =>
  `<!doctype html><html><head><title>${title}</title>` +
  `<meta name="robots" content="index,follow"></head><body><main><h1>${title}</h1>` +
  `<p>${Array.from({ length: 60 }, (_, i) => `Acme Cloud runs an edge network in ${20 + i} regions for platform teams.`).join(" ")}</p>` +
  `<a href="/pricing">Pricing</a><a href="/docs">Docs</a><a href="/about">About</a></main></body></html>`;

const fakeFetcher: NonNullable<PipelineDeps["fetcher"]> = async (url) => {
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

const PRESENT = "Acme Cloud is the one to beat for platform teams. Globex is cheaper at low volume.";

function makeFakeAsk(): { ask: AskFn; calls: number } {
  let calls = 0;
  const ask: AskFn = async () => {
    calls += 1;
    return {
      ok: true,
      text: PRESENT,
      citations: [
        { url: "https://reviews.example/best-edge-cdn", title: "Best edge CDN" },
        { url: "https://acme.example/pricing", title: "Acme Cloud pricing" },
      ],
      usage: { input_tokens: 1000, output_tokens: 200, searches: 1 },
    };
  };
  return { ask, calls };
}

function makeFakeLlm(): PipelineDeps["llm"] {
  return {
    brandModel: async () => BRAND_MODEL_JSON,
    drafter: async () => "## Draft\n\nA short, concrete page about edge caching for platform teams.",
    judge: async () => JUDGE_JSON,
  };
}

describe("runAuditToFilesWith (fake adapters/LLM/fetcher, $0)", () => {
  it("writes run.json + report.html + report.md and they hold together", async () => {
    const outDir = tempDir();
    const { ask } = makeFakeAsk();
    const { result, bundle, runJsonPath, reportHtmlPath, reportMdPath } = await runAuditToFilesWith(
      engineMod,
      reportMod,
      {
        runId: "run_test_audit_1",
        brandName: "Acme Cloud",
        domain: "acme.example",
        competitors: ["Globex"],
        profile: "smoke",
        engines: ["chatgpt", "claude"],
        keys: {},
        deps: { ask, llm: makeFakeLlm(), fetcher: fakeFetcher },
      },
      outDir,
    );

    expect(result.status).toBe("done");
    expect(result.answers.length).toBeGreaterThan(0);
    expect(bundle.version).toBe(1);
    expect(bundle.run.brand.name).toBe("Acme Cloud");

    // run.json validates through the engine's own bundle schema
    const raw = readFileSync(runJsonPath!, "utf8");
    const parsed = engineMod.readBundle(JSON.parse(raw));
    expect(parsed.run.id).toBe("run_test_audit_1");

    const html = readFileSync(reportHtmlPath!, "utf8");
    expect(html).toContain("#brief");
    expect(html).toContain("#dossier");

    const md = readFileSync(reportMdPath!, "utf8");
    expect(md).toMatch(/Acme Cloud/);
    // the verdict language the Brief hero always renders
    expect(md).toMatch(/Present in|Recommended|recommended/i);
  }, 90000);

  it("--format writes ONLY the requested files (and the sample banner rides along)", async () => {
    const outDir = tempDir();
    const { ask } = makeFakeAsk();
    const { runJsonPath, reportHtmlPath, reportMdPath } = await runAuditToFilesWith(
      engineMod,
      reportMod,
      {
        runId: "run_test_audit_format",
        brandName: "Acme Cloud",
        domain: "acme.example",
        competitors: ["Globex"],
        profile: "smoke",
        engines: ["chatgpt", "claude"],
        keys: {},
        format: ["md"],
        sampleNotice: "A fictional company",
        deps: { ask, llm: makeFakeLlm(), fetcher: fakeFetcher },
      },
      outDir,
    );

    // a path is null exactly when that file was not asked for, so no caller
    // can print a path to a file that does not exist
    expect(runJsonPath).toBeNull();
    expect(reportHtmlPath).toBeNull();
    expect(reportMdPath).not.toBeNull();
    expect(existsSync(path.join(outDir, "run.json"))).toBe(false);
    expect(existsSync(path.join(outDir, "report.html"))).toBe(false);
    const md = readFileSync(reportMdPath!, "utf8");
    expect(md.split("\n")[0]).toBe("> **A fictional company**");
  }, 90000);

  // SINGLE-PROVIDER MODE one key end to end.
  it("with ONE provider key, run.json says single-family and report.html states it once in each layer", async () => {
    const prevOpenai = process.env.OPENAI_API_KEY;
    const prevAnthropic = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-openai"; // fake: no call is made (llm is injected)
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const outDir = tempDir();
      const { ask } = makeFakeAsk();
      const { result, runJsonPath, reportHtmlPath } = await runAuditToFilesWith(
        engineMod,
        reportMod,
        {
          runId: "run_test_single_family",
          brandName: "Acme Cloud",
          domain: "acme.example",
          competitors: ["Globex"],
          profile: "smoke",
          engines: ["chatgpt"],
          keys: { openai: "sk-test-openai" },
          deps: { ask, llm: makeFakeLlm(), fetcher: fakeFetcher },
        },
        outDir,
      );

      expect(result.status).toBe("done");
      expect(result.judgeMode).toBe("single-family");

      const parsed = engineMod.readBundle(JSON.parse(readFileSync(runJsonPath!, "utf8")));
      expect(parsed.run.judge_mode).toBe("single-family");
      expect(parsed.run.roles?.["judge:for-chatgpt"].family).toBe("openai");

      const html = readFileSync(reportHtmlPath!, "utf8");
      // Count RENDERED occurrences only (the sentence opens a text node): the
      // hydration bundle also carries the constant as a string literal, so a
      // bare substring count would see three.
      const rendered = ">Judged by a single model family (one provider key).";
      // once in the masthead colophon, once in the Brief's verdict area
      expect(html.split(rendered).length - 1).toBe(2);
    } finally {
      if (prevOpenai === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevOpenai;
      if (prevAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevAnthropic;
    }
  }, 90000);
});

// buildCrawlerFetcher (UA + allowPrivate,
// scoped to the audited host) and buildCrawlerHooks (max-pages truncation +
// locale translation, wired through the pipeline's existing hooks seam).
describe("buildCrawlerFetcher", () => {
  const okFetcher: NonNullable<PipelineDeps["fetcher"]> = async (url, opts) => ({
    status: 200,
    finalUrl: url,
    text: JSON.stringify(opts ?? {}),
  });

  it("returns the base fetcher unchanged when neither option is set", () => {
    expect(buildCrawlerFetcher(okFetcher, "acme.com", {})).toBe(okFetcher);
  });

  it("applies the user-agent to every call", async () => {
    const wrapped = buildCrawlerFetcher(okFetcher, "acme.com", { userAgent: "MyBot/1.0" });
    const r1 = await wrapped("https://acme.com/");
    expect(JSON.parse(r1.text).ua).toBe("MyBot/1.0");
    const r2 = await wrapped("https://reviews.example/best-cdn");
    expect(JSON.parse(r2.text).ua).toBe("MyBot/1.0");
  });

  it("applies allowPrivate ONLY to the audited host and its www/apex sibling", async () => {
    const wrapped = buildCrawlerFetcher(okFetcher, "acme.com", { allowPrivate: true });
    const own = await wrapped("https://acme.com/pricing");
    expect(JSON.parse(own.text).allowPrivate).toBe(true);
    const sibling = await wrapped("https://www.acme.com/pricing");
    expect(JSON.parse(sibling.text).allowPrivate).toBe(true);
    const thirdParty = await wrapped("https://reviews.example/best-cdn");
    expect(JSON.parse(thirdParty.text).allowPrivate).toBeUndefined();
  });

  it("a domain with a scheme still resolves the audited host correctly", async () => {
    const wrapped = buildCrawlerFetcher(okFetcher, "https://acme.com", { allowPrivate: true });
    const own = await wrapped("https://acme.com/");
    expect(JSON.parse(own.text).allowPrivate).toBe(true);
  });
});

describe("buildCrawlerHooks", () => {
  const fakeDrafter: NonNullable<PipelineDeps["llm"]>["drafter"] = async () => "unused";

  it("returns {} (no hooks) when neither maxPages nor locale is set", () => {
    expect(buildCrawlerHooks(undefined, fakeDrafter)).toEqual({});
    expect(buildCrawlerHooks({}, fakeDrafter)).toEqual({});
  });

  it("onSitePages truncates the pages array in place to maxPages", async () => {
    const hooks = buildCrawlerHooks({ maxPages: 2 }, fakeDrafter);
    const pages = [{ url: "a" }, { url: "b" }, { url: "c" }, { url: "d" }] as never[];
    await hooks.onSitePages?.(pages);
    expect(pages).toHaveLength(2);
    expect(pages).toEqual([{ url: "a" }, { url: "b" }]);
  });

  it("onSitePages is a no-op when already at/under the cap", async () => {
    const hooks = buildCrawlerHooks({ maxPages: 5 }, fakeDrafter);
    const pages = [{ url: "a" }, { url: "b" }] as never[];
    await hooks.onSitePages?.(pages);
    expect(pages).toHaveLength(2);
  });

  it("onQuestionSet translates every question's text and marks translated:true", async () => {
    const drafter: typeof fakeDrafter = async ({ user }) => {
      const lines = user.split("\n").filter((l) => /^\d+\./.test(l));
      return lines.map((l) => `[DE] ${l.replace(/^\d+\.\s*/, "")}`).join("\n");
    };
    const hooks = buildCrawlerHooks({ locale: "de" }, drafter);
    const envelope = {
      questions: [
        { qid: "q1", text: "What is the best CDN?", qtype: "category" },
        { qid: "q2", text: "Is it affordable?", qtype: "pricing" },
      ],
      version: 1,
      engines: ["chatgpt"],
    } as never;
    await hooks.onQuestionSet?.(envelope);
    expect((envelope as { questions: { text: string; translated?: boolean }[] }).questions).toEqual([
      { qid: "q1", text: "[DE] What is the best CDN?", qtype: "category", translated: true },
      { qid: "q2", text: "[DE] Is it affordable?", qtype: "pricing", translated: true },
    ]);
  });

  it("onQuestionSet leaves questions untouched when the drafter returns null", async () => {
    const drafter: typeof fakeDrafter = async () => null;
    const hooks = buildCrawlerHooks({ locale: "de" }, drafter);
    const envelope = {
      questions: [{ qid: "q1", text: "What is the best CDN?", qtype: "category" }],
      version: 1,
      engines: ["chatgpt"],
    } as never;
    await hooks.onQuestionSet?.(envelope);
    expect((envelope as { questions: { text: string; translated?: boolean }[] }).questions[0].translated).toBeUndefined();
  });

  it("onQuestionSet leaves questions untouched when the line count doesn't match", async () => {
    const drafter: typeof fakeDrafter = async () => "only one line";
    const hooks = buildCrawlerHooks({ locale: "de" }, drafter);
    const envelope = {
      questions: [
        { qid: "q1", text: "A", qtype: "category" },
        { qid: "q2", text: "B", qtype: "category" },
      ],
      version: 1,
      engines: ["chatgpt"],
    } as never;
    await hooks.onQuestionSet?.(envelope);
    const qs = (envelope as { questions: { text: string; translated?: boolean }[] }).questions;
    expect(qs[0].text).toBe("A");
    expect(qs[1].text).toBe("B");
  });
});

describe("runAuditToFilesWith — crawler options wired end to end (F3 max-pages, F5 locale)", () => {
  it("crawler.maxPages caps result.sitePages after the crawl", async () => {
    const outDir = tempDir();
    const { ask } = makeFakeAsk();
    const { result } = await runAuditToFilesWith(
      engineMod,
      reportMod,
      {
        runId: "run_test_maxpages",
        brandName: "Acme Cloud",
        domain: "acme.example",
        competitors: ["Globex"],
        profile: "smoke",
        engines: ["chatgpt"],
        keys: {},
        deps: { ask, llm: makeFakeLlm(), fetcher: fakeFetcher },
        crawler: { maxPages: 1 },
      },
      outDir,
    );
    expect(result.sitePages.length).toBe(1);
  }, 90000);

  it("crawler.locale translates a freshly generated question set once, marking translated:true", async () => {
    const outDir = tempDir();
    const { ask } = makeFakeAsk();
    const llm = makeFakeLlm()!;
    llm.drafter = async ({ system, user }) => {
      if (system.includes("translate")) {
        const lines = user.split("\n").filter((l) => /^\d+\./.test(l));
        return lines.map((l) => `[DE] ${l.replace(/^\d+\.\s*/, "")}`).join("\n");
      }
      return "## Draft\n\nA short page.";
    };
    const { runJsonPath } = await runAuditToFilesWith(
      engineMod,
      reportMod,
      {
        runId: "run_test_locale",
        brandName: "Acme Cloud",
        domain: "acme.example",
        competitors: ["Globex"],
        profile: "smoke",
        engines: ["chatgpt"],
        keys: {},
        deps: { ask, llm, fetcher: fakeFetcher },
        crawler: { locale: "de" },
      },
      outDir,
    );
    const parsed = engineMod.readBundle(JSON.parse(readFileSync(runJsonPath!, "utf8")));
    expect(parsed.questions.length).toBeGreaterThan(0);
    for (const q of parsed.questions) {
      expect(q.text.startsWith("[DE] ")).toBe(true);
      expect((q as unknown as { translated?: boolean }).translated).toBe(true);
    }
  }, 90000);
});

describe("runVerifyToFilesWith (fake adapters/LLM/fetcher, $0)", () => {
  it("reuses the frozen questions and writes movement.html", async () => {
    const baseDir = tempDir();
    const { ask } = makeFakeAsk();
    const { runJsonPath: baselinePathOrNull } = await runAuditToFilesWith(
      engineMod,
      reportMod,
      {
        runId: "run_test_verify_baseline",
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
    const baselinePath = baselinePathOrNull!;

    const verifyDir = tempDir();
    const { ask: verifyAsk } = makeFakeAsk();
    const { result, baseline, current, movementHtmlPath } = await runVerifyToFilesWith(
      engineMod,
      reportMod,
      {
        runId: "run_test_verify_1",
        baselinePath,
        keys: {},
        deps: { ask: verifyAsk, llm: makeFakeLlm(), fetcher: fakeFetcher },
      },
      verifyDir,
    );

    expect(result.kind).toBe("verify");
    expect(current.questions).toEqual(baseline.questions); // frozen set reused verbatim
    expect(current.run.engines).toEqual(baseline.run.engines);
    const html = readFileSync(movementHtmlPath!, "utf8");
    expect(html.length).toBeGreaterThan(0);
  }, 90000);
});

describe("hasEngineFailures (exit-code 2 on ANY provider failure, not just a total wipeout)", () => {
  it("false when every answer is ok", () => {
    const answers = [
      { engine: "chatgpt" as const, ok: true },
      { engine: "claude" as const, ok: true },
    ];
    expect(hasEngineFailures(["chatgpt", "claude"], answers)).toBe(false);
  });

  it("true when an engine failed EVERY draw (today's case)", () => {
    const answers = [
      { engine: "chatgpt" as const, ok: true },
      { engine: "claude" as const, ok: false },
    ];
    expect(hasEngineFailures(["chatgpt", "claude"], answers)).toBe(true);
  });

  it("true when an engine failed SOME draws but not all (a real run: 1 gemini 503, 5 perplexity 429s)", () => {
    const answers = [
      { engine: "gemini" as const, ok: true },
      { engine: "gemini" as const, ok: true },
      { engine: "gemini" as const, ok: false }, // 1 of 3 failed — still a real failure
      { engine: "perplexity" as const, ok: true },
      { engine: "perplexity" as const, ok: false },
    ];
    expect(hasEngineFailures(["gemini", "perplexity"], answers)).toBe(true);
  });
});

describe("runAuditToFilesWith with a fake adapter that fails some draws", () => {
  it("keeps the ok draws, marks the failed ones, and the run still completes", async () => {
    const outDir = tempDir();
    let calls = 0;
    // perplexity 429-rate-limits every OTHER draw; chatgpt always succeeds.
    const flakyAsk: AskFn = async (engine) => {
      calls += 1;
      if (engine === "perplexity" && calls % 2 === 0) {
        return { ok: false, text: "", citations: [], error: "429 rate-limited" };
      }
      return { ok: true, text: PRESENT, citations: [{ url: "https://reviews.example/x", title: "x" }] };
    };

    const { result } = await runAuditToFilesWith(
      engineMod,
      reportMod,
      {
        runId: "run_test_flaky",
        brandName: "Acme Cloud",
        domain: "acme.example",
        competitors: ["Globex"],
        profile: "smoke",
        engines: ["chatgpt", "perplexity"],
        keys: {},
        deps: { ask: flakyAsk, llm: makeFakeLlm(), fetcher: fakeFetcher },
      },
      outDir,
    );

    expect(result.status).toBe("done"); // a partial provider failure never fails the whole run
    const perplexityAnswers = result.answers.filter((a) => a.engine === "perplexity");
    expect(perplexityAnswers.some((a) => a.ok)).toBe(true);
    expect(perplexityAnswers.some((a) => !a.ok)).toBe(true);
    expect(hasEngineFailures(["chatgpt", "perplexity"], result.answers)).toBe(true);
    expect(hasEngineFailures(["chatgpt"], result.answers)).toBe(false);
  }, 90000);
});

// ---------------------------------------------------------------------------
// the whole chain, proved on real files: an adapter throws an error
// that EMBEDS the provider key (the Gemini shape: the key is a query param of
// the URL the transport echoes back). It must survive nowhere — not in the
// AskResult.error the engine copies into AnswerRow.error and hands to the
// Inngest step, not in run.json, not in report.html, not in report.md.
// ---------------------------------------------------------------------------
describe("a provider key never reaches the bundle, the report or a step's error", () => {
  const GEMINI_KEY = "AIzaSyD-p4-secret-key-value-0123456789x";
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevOpenai = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
    if (prevOpenai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenai;
    clearRegisteredSecrets();
  });

  it("redacts it from AskResult.error, run.json, report.html and report.md", async () => {
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    registerSecret(GEMINI_KEY); // what applyKeysToEnv does for every resolved key

    // The adapter boundary the CLI actually uses: a throwing provider call
    // wrapped by engine adapters/shared.ts's failed().
    const leakyAsk: AskFn = async () => {
      const thrown = new Error(
        `fetch failed: GET https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent?key=${GEMINI_KEY}`,
      );
      return failed(thrown);
    };

    const outDir = tempDir();
    const { result, runJsonPath, reportHtmlPath, reportMdPath } = await runAuditToFilesWith(
      engineMod,
      reportMod,
      {
        runId: "run_test_p4_redaction",
        brandName: "Acme Cloud",
        domain: "acme.example",
        competitors: ["Globex"],
        profile: "smoke",
        engines: ["chatgpt", "claude"],
        keys: {},
        deps: { ask: leakyAsk, llm: makeFakeLlm(), fetcher: fakeFetcher },
      },
      outDir,
    );

    // 1. the error string a step returns (this is what reaches Inngest state)
    const errors = result.answers.map((a) => a.error ?? "").filter(Boolean);
    expect(errors.length).toBeGreaterThan(0);
    for (const e of errors) {
      expect(e).not.toContain(GEMINI_KEY);
      expect(e).toContain("[redacted]");
    }

    // 2. the serialized bundle people commit and attach to issues
    const runJson = readFileSync(runJsonPath!, "utf8");
    expect(runJson).not.toContain(GEMINI_KEY);
    expect(runJson).not.toContain("AIzaSyD-p4-secret");

    // 3. the two report files people publish
    expect(readFileSync(reportHtmlPath!, "utf8")).not.toContain(GEMINI_KEY);
    expect(readFileSync(reportMdPath!, "utf8")).not.toContain(GEMINI_KEY);
  }, 90000);
});
