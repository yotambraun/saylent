// The whole pipeline, end to end, with ZERO network and ZERO LLM spend: fake
// adapters, a fake judge, a fake drafter and a fake fetcher over a fictional
// site (acme.example). Asserts the things a refactor could silently break:
// stage order, ONE durable step per engine, the adaptive tiebreak firing only on
// disagreement, a row in every table, and step-for-step equivalence between the
// direct runner and a recording runner whose ids must match today's Inngest ids.
import { describe, expect, it } from "vitest";
import { readBundle, toBundle, writeBundle } from "./bundle";
import { MemoryDbWriter } from "./memory-writer";
import { type ModelRegistry, resolveRoles } from "./models";
import { freezeSamples, PROFILES, selectQuestions } from "./profiles";
import type { AskFn } from "./observe";
import {
  type Fetcher,
  modelsUsed,
  runAudit,
  runRoles,
  type RunStage,
  selectForProfile,
  type StepRunner,
} from "./run-audit";
import type { Question } from "./types";

// The step ids the Inngest audit function used BEFORE the engine extract, in
// order. This list is the contract: a change here is a change to the durable
// step boundaries (memoization + retry granularity) of every in-flight run.
const INNGEST_STEPS = [
  "crawl",
  "brand-model",
  "questions",
  "observe:chatgpt",
  "observe:claude",
  "judge",
  "corpus",
  "domain-checks",
  "fixes",
  "finish",
];

const FROZEN: Question[] = [
  { qid: "q01", text: "best edge CDN for platform teams", qtype: "category" },
  { qid: "q02", text: "how do I stop slow global page loads", qtype: "problem" },
  { qid: "q03", text: "Acme Cloud vs Globex", qtype: "comparison" },
  { qid: "q04", text: "is Acme Cloud any good", qtype: "branded" },
];

const QUESTION_SET = { questions: FROZEN, version: 3, engines: ["chatgpt", "claude"] };

const BODY = Array.from(
  { length: 60 },
  (_, i) => `Acme Cloud runs an edge network in ${20 + i} regions for platform teams.`,
).join(" ");

const page = (title: string) =>
  `<!doctype html><html><head><title>${title}</title>` +
  `<meta name="robots" content="index,follow"></head><body><main><h1>${title}</h1>` +
  `<p>${BODY}</p><a href="/pricing">Pricing</a><a href="/docs">Docs</a>` +
  `<a href="/about">About</a></main></body></html>`;

const fakeFetcher: Fetcher = async (url) => {
  if (url.endsWith("/robots.txt")) {
    return { status: 200, finalUrl: url, text: "User-agent: *\nAllow: /\n" };
  }
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

const PRESENT = `Acme Cloud is the one to beat for platform teams. Globex is cheaper at low volume.`;
const ABSENT = `Globex and Initech both ship an edge network worth a look.`;

interface AskLog {
  ask: AskFn;
  calls: { engine: string; question: string; draw: number }[];
}

/** q01 disagrees on its second draw (recommended, then absent) so exactly that
 *  group needs a tiebreak; q02 agrees across both draws so it must NOT get one. */
function makeAsk(): AskLog {
  const seen = new Map<string, number>();
  const calls: AskLog["calls"] = [];
  const ask: AskFn = async (engine, question) => {
    const key = `${engine}|${question}`;
    const draw = seen.get(key) ?? 0;
    seen.set(key, draw + 1);
    calls.push({ engine, question, draw });
    const disagrees = question === FROZEN[0].text && draw === 1;
    return {
      ok: true,
      text: disagrees ? ABSENT : PRESENT,
      citations: [
        { url: "https://reviews.example/best-edge-cdn", title: "Best edge CDN" },
        { url: "https://acme.example/pricing", title: "Acme Cloud pricing" },
      ],
      usage: { input_tokens: 1000, output_tokens: 200, searches: 1 },
    };
  };
  return { ask, calls };
}

function makeDeps(overrides: { step?: StepRunner; onStage?: (s: RunStage, d: string) => void } = {}) {
  const db = new MemoryDbWriter();
  const { ask, calls } = makeAsk();
  let judgeCalls = 0;
  let drafterCalls = 0;
  return {
    db,
    calls,
    judged: () => judgeCalls,
    drafted: () => drafterCalls,
    deps: {
      db,
      ask,
      llm: {
        brandModel: async () => BRAND_MODEL_JSON,
        drafter: async () => {
          drafterCalls += 1;
          return "## Draft\n\nA short, concrete page about edge caching for platform teams.";
        },
        judge: async () => {
          judgeCalls += 1;
          return JUDGE_JSON;
        },
      },
      fetcher: fakeFetcher,
      hooks: db.hooks(),
      ...overrides,
    },
  };
}

const INPUT = {
  runId: "run_test_1",
  kind: "audit" as const,
  profile: "full" as const,
  brand: { id: "brand_1", name: "Acme Cloud", domain: "acme.example", category: "edge CDN" },
  engines: ["chatgpt", "claude"],
  questionSet: QUESTION_SET,
  currentYear: 2026,
};

describe("runAudit", () => {
  it("runs the whole pipeline on fakes: stages in order, a row in every table", async () => {
    const stages: RunStage[] = [];
    const { db, deps } = makeDeps({ onStage: (s) => stages.push(s) });

    const result = await runAudit(INPUT, deps);

    expect(result.status).toBe("done");
    expect(stages).toEqual([
      "crawl",
      "brand-model",
      "questions",
      "observe",
      "observe",
      "judge",
      "corpus",
      "domain-checks",
      "fixes",
      "score",
    ]);

    // one canonical answer per (question, engine)
    expect(db.answers).toHaveLength(FROZEN.length * 2);
    expect(db.answers.every((a) => a.run_id === "run_test_1")).toBe(true);
    expect(db.answers.every((a) => a.raw_text.length > 0)).toBe(true);

    // every table the pipeline owns has rows
    expect(db.answer_samples.length).toBeGreaterThan(0);
    expect(db.citations.length).toBeGreaterThan(0);
    expect(db.corpus_pages.length).toBeGreaterThan(0);
    expect(db.domain_checks.length).toBeGreaterThan(0);
    expect(db.fixes.length).toBeGreaterThan(0);
    expect(db.stages.length).toBeGreaterThan(0);

    // the run row is finished with scores + a cost
    const run = db.run("run_test_1");
    expect(run?.status).toBe("done");
    expect(run?.scores).not.toBeNull();
    expect(run?.est_cost_usd).toBeGreaterThan(0);

    // the result mirrors what was persisted (the lossless in-process record)
    expect(result.answers).toHaveLength(db.answers.length);
    expect(result.samples).toHaveLength(db.answer_samples.length);
    expect(result.citations).toHaveLength(db.citations.length);
    expect(result.engines).toEqual(["chatgpt", "claude"]);
    // Samples feature: a fresh audit stamps the EFFECTIVE per-question sample
    // count onto the frozen set (full profile default = 2 for scored, 1 for
    // everything else) — see profiles.freezeSamples.
    expect(result.frozenQuestions).toEqual(freezeSamples(FROZEN, 2));
    expect(result.sampling).toEqual({ samples: 2, tiebreak: true, source: "profile" });
    expect(result.parseFailures).toBe(0);
  });

  it("asks the adaptive tiebreak ONLY for the scored group that disagreed", async () => {
    const { db, calls, deps } = makeDeps();
    await runAudit(INPUT, deps);

    // q01 (scored, disagreeing) → 2 initial + 1 tiebreak; q02 (scored, agreeing)
    // → 2 initial and NO third; q03/q04 (not scored) → 1 each. Per engine: 7.
    const perEngine = (engine: string, qid: string) =>
      calls.filter((c) => c.engine === engine && c.question === FROZEN.find((q) => q.qid === qid)!.text)
        .length;
    for (const engine of ["chatgpt", "claude"]) {
      expect(perEngine(engine, "q01")).toBe(3);
      expect(perEngine(engine, "q02")).toBe(2);
      expect(perEngine(engine, "q03")).toBe(1);
      expect(perEngine(engine, "q04")).toBe(1);
    }
    expect(calls).toHaveLength(14);

    // the tiebreak draw is persisted as sample_idx 2 on q01 only
    const tiebreaks = db.answer_samples.filter((s) => s.sample_idx === 2);
    expect(tiebreaks).toHaveLength(2);
    expect(tiebreaks.every((s) => s.qid === "q01")).toBe(true);
    // agreeing pairs still leave their per-sample evidence behind
    expect(db.answer_samples.filter((s) => s.qid === "q02")).toHaveLength(4);
    // single-draw questions have no sample rows (nothing varied to record)
    expect(db.answer_samples.filter((s) => s.qid === "q03")).toHaveLength(0);
  });

  it("runs ONE step per engine, with today's Inngest step ids in today's order", async () => {
    const names: string[] = [];
    const recording: StepRunner = {
      run: (name, fn) => {
        names.push(name);
        return fn();
      },
    };
    const { deps } = makeDeps({ step: recording });
    await runAudit(INPUT, deps);
    expect(names).toEqual(INNGEST_STEPS);
    expect(names.filter((n) => n.startsWith("observe:"))).toEqual([
      "observe:chatgpt",
      "observe:claude",
    ]);
  });

  it("is row-identical through the direct runner and a recording step runner", async () => {
    const direct = makeDeps();
    await runAudit(INPUT, direct.deps);

    const names: string[] = [];
    const recorded = makeDeps({
      step: {
        run: (name, fn) => {
          names.push(name);
          return fn();
        },
      },
    });
    await runAudit(INPUT, recorded.deps);

    expect(names).toEqual(INNGEST_STEPS);
    expect(recorded.db.answers).toEqual(direct.db.answers);
    expect(recorded.db.answer_samples).toEqual(direct.db.answer_samples);
    expect(recorded.db.citations).toEqual(direct.db.citations);
    expect(recorded.db.corpus_pages).toEqual(direct.db.corpus_pages);
    expect(recorded.db.domain_checks).toEqual(direct.db.domain_checks);
    expect(recorded.db.fixes).toEqual(direct.db.fixes);
    expect(recorded.db.stages).toEqual(direct.db.stages);
    expect(recorded.db.run("run_test_1")?.scores).toEqual(direct.db.run("run_test_1")?.scores);
    expect(recorded.db.run("run_test_1")?.est_cost_usd).toEqual(
      direct.db.run("run_test_1")?.est_cost_usd,
    );
  });

  it("verify reuses the frozen set and skips crawl/brand-model/questions/corpus/gates/fixes", async () => {
    const names: string[] = [];
    const { db, deps } = makeDeps({
      step: {
        run: (name, fn) => {
          names.push(name);
          return fn();
        },
      },
    });
    const result = await runAudit(
      {
        ...INPUT,
        runId: "run_test_verify",
        kind: "verify",
        brand: { ...INPUT.brand, aliases: ["Acme Cloud", "Acme"], icp: "platform teams" },
      },
      deps,
    );
    expect(names).toEqual(["observe:chatgpt", "observe:claude", "judge", "finish"]);
    expect(result.questions).toEqual(FROZEN);
    expect(db.corpus_pages).toHaveLength(0);
    expect(db.domain_checks).toHaveLength(0);
    expect(db.fixes).toHaveLength(0);
    expect(db.answers).toHaveLength(FROZEN.length * 2);
  });

  // ---- stage skips ----

  it("skip.drafts: diagnose still runs, but draftArtifacts (the drafter LLM call) never fires", async () => {
    const { db, deps, drafted } = makeDeps();
    const result = await runAudit({ ...INPUT, runId: "run_skip_drafts", skip: { drafts: true } }, deps);
    expect(result.status).toBe("done");
    expect(drafted()).toBe(0); // no drafter LLM calls at all
    expect(db.fixes.length).toBeGreaterThan(0); // diagnose() still ran
    expect(result.skip).toEqual({ drafts: true });
  });

  it("skip.corpus: buildCorpus never runs — no cited-page fetches, corpus stays empty", async () => {
    const hostsFetched: string[] = [];
    const { db, deps } = makeDeps();
    const countingFetcher: Fetcher = async (url, opts) => {
      hostsFetched.push(new URL(url).hostname);
      return fakeFetcher(url, opts);
    };
    const result = await runAudit(
      { ...INPUT, runId: "run_skip_corpus", skip: { corpus: true } },
      { ...deps, fetcher: countingFetcher },
    );
    expect(result.status).toBe("done");
    expect(db.corpus_pages).toHaveLength(0);
    expect(hostsFetched).not.toContain("reviews.example"); // never fetched a cited page
    expect(result.skip).toEqual({ corpus: true });
  });

  it("skip.gates: runDomainChecks never runs — checks stays empty, never a pass", async () => {
    const { db, deps } = makeDeps();
    const result = await runAudit({ ...INPUT, runId: "run_skip_gates", skip: { gates: true } }, deps);
    expect(result.status).toBe("done");
    expect(db.domain_checks).toHaveLength(0);
    expect(result.skip).toEqual({ gates: true });
  });

  it("skip.corpus + skip.gates together, both honored in one run (drafts untouched)", async () => {
    const { db, deps } = makeDeps();
    const result = await runAudit(
      { ...INPUT, runId: "run_skip_both", skip: { corpus: true, gates: true } },
      deps,
    );
    expect(result.status).toBe("done");
    expect(db.corpus_pages).toHaveLength(0);
    expect(db.domain_checks).toHaveLength(0);
    // drafts were NOT in the skip set — the "skip.drafts" test above already
    // proves drafted() stays 0 when it IS skipped; this fictional fixture's
    // diagnosis (from an empty corpus/checks) may or may not have anything
    // left to draft, so the honest signal here is `input.skip` itself.
    expect(result.skip).toEqual({ corpus: true, gates: true });
  });

  it("nothing skipped ⇒ skip is null (byte-identical to before this feature)", async () => {
    const { deps } = makeDeps();
    const result = await runAudit({ ...INPUT, runId: "run_skip_none" }, deps);
    expect(result.skip).toBeNull();
  });

  it("skip is a no-op on verify: it never reaches drafts/corpus/gates regardless", async () => {
    const { db, deps } = makeDeps();
    const result = await runAudit(
      {
        ...INPUT,
        runId: "run_skip_verify",
        kind: "verify",
        brand: { ...INPUT.brand, aliases: ["Acme Cloud", "Acme"], icp: "platform teams" },
        skip: { drafts: true, corpus: true, gates: true },
      },
      deps,
    );
    expect(result.status).toBe("done");
    expect(db.corpus_pages).toHaveLength(0);
    expect(db.domain_checks).toHaveLength(0);
    expect(db.fixes).toHaveLength(0);
    expect(result.skip).toBeNull(); // nothing to skip on a verify — never echoed
  });

  it("stamps skip into the bundle's run meta and round-trips through readBundle/writeBundle", async () => {
    const { db, deps } = makeDeps();
    const result = await runAudit(
      { ...INPUT, runId: "run_skip_bundle", skip: { drafts: true, gates: true } },
      deps,
    );
    const bundle = toBundle(db, {
      run: {
        id: "run_skip_bundle",
        kind: "audit",
        profile: "full",
        status: result.status,
        brand: { name: INPUT.brand.name, domain: INPUT.brand.domain },
        engines: result.engines,
        models: result.models,
        template_set_version: result.templateSetVersion,
        question_set_version: result.questionSetVersion,
        sampling: result.sampling,
        skip: result.skip,
        judge_mode: result.judgeMode,
        started_at: result.startedAt,
        finished_at: result.finishedAt,
        est_cost_usd: result.costUsd,
      },
      brand_model: result.brandModel,
      questions: result.frozenQuestions,
    });
    expect(bundle.run.skip).toEqual({ drafts: true, gates: true });
    const roundTripped = readBundle(JSON.parse(writeBundle(bundle)));
    expect(roundTripped.run.skip).toEqual({ drafts: true, gates: true });
  });

  it("refuses a verify with no frozen question set", async () => {
    const { deps } = makeDeps();
    await expect(
      runAudit({ ...INPUT, kind: "verify", questionSet: null }, deps),
    ).rejects.toThrow("verify run without a frozen question set");
  });

  it("generates + freezes a question set when the brand has none", async () => {
    let frozen: { questions: Question[]; version: number; engines: string[] } | null = null;
    const { deps } = makeDeps();
    const result = await runAudit(
      {
        ...INPUT,
        runId: "run_test_fresh",
        questionSet: null,
        questionSetVersion: 2,
        engines: ["chatgpt", "claude"],
      },
      {
        ...deps,
        hooks: {
          ...deps.hooks,
          onQuestionSet: (envelope) => {
            frozen = envelope;
          },
        },
      },
    );
    expect(frozen).not.toBeNull();
    expect(frozen!.version).toBe(2);
    expect(frozen!.engines).toEqual(["chatgpt", "claude"]);
    expect(frozen!.questions.length).toBeGreaterThan(0);
    expect(result.frozenQuestions).toEqual(frozen!.questions);
  });

  it("saylent.config questionTemplates stamps the run '<base>+custom' and the new group is generated", async () => {
    const { deps } = makeDeps();
    const result = await runAudit(
      {
        ...INPUT,
        runId: "run_test_templates",
        questionSet: null,
        questionSetVersion: 2,
        engines: ["chatgpt", "claude"],
        questionTemplates: { pricing: { templates: ["Is {brand} affordable for {icp}?"], quota: 1 } },
      },
      deps,
    );
    expect(result.templateSetVersion).toBe("2+custom");
    expect(result.frozenQuestions.some((q) => q.qtype === "custom")).toBe(true);
  });

  it("saylent.config extraBots + thresholds are passed through to the domain checks + fix weights", async () => {
    const { db, deps } = makeDeps();
    const result = await runAudit(
      {
        ...INPUT,
        runId: "run_test_config_thresholds",
        extraBots: [{ agent: "MyCrawlerBot", kind: "search" }],
        thresholds: { coverage: 0.99, fixWeights: { access: 1.5 } },
      },
      deps,
    );
    expect(result.status).toBe("done");
    expect(db.domain_checks.some((c) => c.check_name === "robots: MyCrawlerBot")).toBe(true);
  });
});

// Samples feature: the operator controls how many times each question is
// asked. q01 (FROZEN[0], category) disagrees on its SECOND draw in every
// fake-ask helper above — reused here as the "would tiebreak if eligible" probe.
describe("Samples feature", () => {
  const perEngineCalls = (calls: AskLog["calls"], engine: string, qid: string) =>
    calls.filter((c) => c.engine === engine && c.question === FROZEN.find((q) => q.qid === qid)!.text).length;

  it("a run-level --samples flag overrides the profile default for scored questions", async () => {
    const { calls, deps } = makeDeps();
    const result = await runAudit(
      { ...INPUT, runId: "run_test_samples_run_level", profile: "smoke", samples: 2 },
      deps,
    );
    expect(result.status).toBe("done");
    expect(result.sampling).toEqual({ samples: 2, tiebreak: true, source: "flag" });
    for (const engine of ["chatgpt", "claude"]) {
      expect(perEngineCalls(calls, engine, "q01")).toBe(3); // 2 initial + tiebreak (disagrees)
      expect(perEngineCalls(calls, engine, "q02")).toBe(2); // 2 initial, agrees — no tiebreak
      expect(perEngineCalls(calls, engine, "q03")).toBe(1); // non-scored: unaffected by --samples
    }
  });

  it("a per-question samples override wins over the run-level default, and never gets the n=2 tiebreak", async () => {
    const { calls, deps } = makeDeps();
    const customQuestions = FROZEN.map((q) => (q.qid === "q02" ? { ...q, samples: 4 } : q));
    const result = await runAudit(
      {
        ...INPUT,
        runId: "run_test_samples_per_question",
        questionSet: { questions: customQuestions, version: 3, engines: ["chatgpt", "claude"] },
      },
      deps,
    );
    expect(result.status).toBe("done");
    // the bundle's frozen questions record the EFFECTIVE count per question:
    // q02's explicit override survives untouched, q01 gets the run-level default.
    expect(result.frozenQuestions.find((q) => q.qid === "q02")!.samples).toBe(4);
    expect(result.frozenQuestions.find((q) => q.qid === "q01")!.samples).toBe(2);
    for (const engine of ["chatgpt", "claude"]) {
      expect(perEngineCalls(calls, engine, "q01")).toBe(3); // run-level default 2 + tiebreak
      expect(perEngineCalls(calls, engine, "q02")).toBe(4); // override — no tiebreak possible at n=4
      expect(perEngineCalls(calls, engine, "q03")).toBe(1);
    }
  });

  it("--samples 1 produces no tiebreak draw, even for a question that would otherwise disagree", async () => {
    const { calls, deps } = makeDeps();
    const result = await runAudit({ ...INPUT, runId: "run_test_samples_one", samples: 1 }, deps);
    expect(result.status).toBe("done");
    expect(result.sampling).toEqual({ samples: 1, tiebreak: false, source: "flag" });
    for (const engine of ["chatgpt", "claude"]) {
      for (const qid of ["q01", "q02", "q03", "q04"]) {
        expect(perEngineCalls(calls, engine, qid)).toBe(1);
      }
    }
  });

  it("recommendedBand stays honest over mixed per-question sample counts (score.ts unchanged)", async () => {
    const { deps } = makeDeps();
    const customQuestions = FROZEN.map((q) => (q.qid === "q02" ? { ...q, samples: 4 } : q));
    const result = await runAudit(
      {
        ...INPUT,
        runId: "run_test_samples_band",
        questionSet: { questions: customQuestions, version: 3, engines: ["chatgpt", "claude"] },
      },
      deps,
    );
    const band = result.scores?.recommended_band;
    expect(band).toBeDefined();
    expect(band!.overall.min).toBeLessThanOrEqual(band!.overall.max);
    // q01's disagreement (tiebroken to 3 draws) is real variance the band must
    // not silently drop just because q02 was sampled at a different count (4).
    expect(band!.overall.max).toBeGreaterThan(band!.overall.min);
  });
});

// SINGLE-PROVIDER MODE: the same fake pipeline with
// ONE provider family. The run must complete, every judge call must go to that
// family, and the bundle header must say judge_mode "single-family" with the
// resolved role map.
describe("runAudit with a single provider family", () => {
  it("runs end to end and writes a valid bundle stamped single-family", async () => {
    const { db, deps } = makeDeps();
    const families: string[] = [];
    const roles = resolveRoles({ openai: true }); // OpenAI-only install
    const result = await runAudit(INPUT, {
      ...deps,
      roles,
      llm: {
        ...deps.llm,
        judge: async (family) => {
          families.push(family);
          return JUDGE_JSON;
        },
      },
    });

    expect(result.status).toBe("done");
    expect(result.judgeMode).toBe("single-family");
    expect(result.roles.roles["judge:for-claude"].family).toBe("openai");
    // every judge call (chatgpt AND claude answers) went to the one family
    expect(families.length).toBeGreaterThan(0);
    expect(new Set(families)).toEqual(new Set(["openai"]));
    // brand + drafter models in the header are the OpenAI ones
    expect(result.models.brand).toBe(roles.roles.brand.model);
    expect(result.models.drafter).toBe(roles.roles.drafter.model);
    // scoring is untouched: the pipeline still produced a full result
    expect(result.scores).not.toBeNull();
    expect(result.answers).toHaveLength(FROZEN.length * 2);

    const bundle = toBundle(db, {
      run: {
        id: INPUT.runId,
        kind: "audit",
        profile: "full",
        status: result.status,
        brand: { name: INPUT.brand.name, domain: INPUT.brand.domain },
        engines: result.engines,
        models: result.models,
        judge_mode: result.judgeMode,
        roles: runRoles(result.roles),
        template_set_version: result.templateSetVersion,
        question_set_version: result.questionSetVersion,
        started_at: result.startedAt,
        finished_at: result.finishedAt,
        est_cost_usd: result.costUsd,
      },
      brand_model: result.brandModel,
      questions: result.frozenQuestions,
    });

    // survives the write -> validate round trip (v1 additive-only)
    const round = readBundle(writeBundle(bundle));
    expect(round.run.judge_mode).toBe("single-family");
    expect(round.run.roles?.["judge:for-chatgpt"]).toEqual({
      family: "openai",
      model: roles.roles["judge:for-chatgpt"].model,
    });
    expect(round.answers.length).toBe(result.answers.length);
  });

  it("two families keep the cross-family routing (chatgpt -> anthropic, claude -> openai)", async () => {
    const { deps } = makeDeps();
    const families = new Set<string>();
    const result = await runAudit(INPUT, {
      ...deps,
      roles: resolveRoles({ openai: true, anthropic: true }),
      llm: {
        ...deps.llm,
        judge: async (family) => {
          families.add(family);
          return JUDGE_JSON;
        },
      },
    });
    expect(result.judgeMode).toBe("cross-family");
    expect([...families].sort()).toEqual(["anthropic", "openai"]);
  });
});

describe("selectForProfile — user-authored --questions rows survive a smoke profile", () => {
  // profiles.selectQuestions picks one of each of category/comparison/problem/branded
  // first, then up to one MORE category and one more comparison — cycle through all
  // four types so a "20 templated rows" fixture can actually fill the smoke budget.
  const TYPES = ["category", "comparison", "problem", "branded"] as const;
  const templated = (n: number): Question[] =>
    Array.from({ length: n }, (_, i) => ({
      qid: `t${String(i + 1).padStart(2, "0")}`,
      text: `templated question ${i + 1}`,
      qtype: TYPES[i % TYPES.length],
    }));

  it("no user rows ⇒ identical to selectQuestions (unchanged behavior)", () => {
    const frozen = FROZEN;
    expect(selectForProfile(frozen, "smoke").map((q) => q.qid)).toEqual(
      selectQuestions(frozen, "smoke").map((q) => q.qid),
    );
  });

  it("a full profile always asks the whole frozen set, user rows included", () => {
    const frozen: Question[] = [
      ...templated(3),
      { qid: "u01", text: "is Acme legit", qtype: "custom", source: "user" },
    ];
    expect(selectForProfile(frozen, "full")).toHaveLength(4);
  });

  it("smoke profile asks every user row, then fills remaining budget from the template selection", () => {
    const frozen: Question[] = [
      ...templated(20),
      { qid: "u01", text: "user question one", qtype: "custom", source: "user" },
      { qid: "u02", text: "user question two", qtype: "custom", source: "user" },
    ];
    const selected = selectForProfile(frozen, "smoke");
    expect(selected).toHaveLength(PROFILES.smoke.questions);
    const userRows = selected.filter((q) => q.source === "user");
    expect(userRows.map((q) => q.qid).sort()).toEqual(["u01", "u02"]);
  });

  it("more user rows than the smoke budget ⇒ every user row still asked (budget grows, none dropped)", () => {
    const frozen: Question[] = Array.from({ length: PROFILES.smoke.questions + 3 }, (_, i) => ({
      qid: `u${String(i + 1).padStart(2, "0")}`,
      text: `user question ${i + 1}`,
      qtype: "custom" as const,
      source: "user" as const,
    }));
    const selected = selectForProfile(frozen, "smoke");
    expect(selected).toHaveLength(frozen.length);
    expect(selected.every((q) => q.source === "user")).toBe(true);
  });
});

describe("modelsUsed — the resolved model registry can be injected (not just MODELS)", () => {
  it("uses the passed registry for answer + judge model names in the run header", () => {
    const registry = {
      chatgptAnswer: "gpt-injected",
      claudeAnswer: "claude-injected",
      geminiAnswer: "gemini-injected",
      perplexityAnswer: "sonar-injected",
      judgeAnthropic: "claude-judge-injected",
      judgeOpenai: "gpt-judge-injected",
      brand: "claude-brand-injected",
      drafter: "claude-drafter-injected",
      brandOpenai: "gpt-brand-injected",
      drafterOpenai: "gpt-drafter-injected",
    } satisfies ModelRegistry;
    const roles = resolveRoles({ anthropic: true }, {});
    const used = modelsUsed(["chatgpt", "claude"], roles, registry);
    expect(used.chatgpt).toBe("gpt-injected");
    expect(used.claude).toBe("claude-injected");
    expect(used.judge_anthropic).toBe("claude-judge-injected");
    expect(used.judge_openai).toBe("gpt-judge-injected");
  });
});
