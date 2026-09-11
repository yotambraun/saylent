// Run bundle v1: the lossless run.json. A bundle that survives
// toBundle → writeBundle → JSON.parse → readBundle unchanged is the whole
// contract (the report renders from it and a verify run reuses its questions).
import { describe, expect, it } from "vitest";
import {
  BUNDLE_VERSION,
  type BundleMeta,
  type BundleRowsInput,
  bundleFromRows,
  readBundle,
  runBundleSchema,
  toBundle,
  writeBundle,
} from "./bundle";
import { MemoryDbWriter } from "./memory-writer";
import type { Engine, Scores, Verdict } from "./types";

const RUN_ID = "run_bundle_1";

const verdict: Verdict = {
  brand_present: true,
  mention_type: "recommended",
  prominence: "first",
  sentiment: "positive",
  claims: [{ text: "runs an edge network", kind: "neutral_fact" }],
  other_brands: [{ name: "Globex", why: "cheaper at low volume" }],
  excerpt: "Acme Cloud is the one to beat",
};

const emptyPerEngine = () => ({
  answered: 0,
  recommended: 0,
  mentioned: 0,
  rec_rate: null,
  mention_rate: null,
});

const scores: Scores = {
  per_engine: {
    chatgpt: { answered: 1, recommended: 1, mentioned: 1, rec_rate: 1, mention_rate: 1 },
    claude: emptyPerEngine(),
    gemini: emptyPerEngine(),
    perplexity: emptyPerEngine(),
  },
  overall: { answered: 1, recommended: 1, mentioned: 1, rec_rate: 1, mention_rate: 1 },
  share_of_voice: { globex: 1 },
};

const meta: BundleMeta = {
  run: {
    id: RUN_ID,
    kind: "audit",
    profile: "smoke",
    status: "done",
    brand: { name: "Acme Cloud", domain: "acme.example" },
    engines: ["chatgpt"] as Engine[],
    models: { chatgpt: "gpt-5.4", judge_anthropic: "claude-haiku-4-5", brand: "claude-haiku-4-5" },
    template_set_version: 2,
    question_set_version: 3,
    started_at: "2026-09-09T10:00:00.000Z",
    finished_at: "2026-09-09T10:03:00.000Z",
    est_cost_usd: 0.42,
  },
  brand_model: {
    brand: "Acme Cloud",
    domain: "acme.example",
    aliases: ["Acme Cloud", "Acme"],
    category: "edge CDN",
    icp: "platform teams",
    products: ["Edge CDN"],
    value_props: ["global cache"],
    problems: ["slow global page loads"],
    competitors: ["Globex"],
    language: "en",
    confidence: "ok",
  },
  questions: [{ qid: "q01", text: "best edge CDN for platform teams", qtype: "category" }],
  health: { grade: "A", notes: [] },
};

async function seed(): Promise<MemoryDbWriter> {
  const db = new MemoryDbWriter();
  await db.setStage(RUN_ID, "Crawling your site");
  await db.saveAnswer({
    runId: RUN_ID,
    qid: "q01",
    qtype: "category",
    question: "best edge CDN for platform teams",
    engine: "chatgpt",
    ok: true,
    raw_text: "Acme Cloud is the one to beat for platform teams.",
    citations: [{ url: "https://reviews.example/best-edge-cdn", title: "Best edge CDN" }],
    verdict,
    usage: { input_tokens: 1000, output_tokens: 200, searches: 1 },
  });
  db.saveAnswerSamples([
    {
      runId: RUN_ID,
      qid: "q01",
      engine: "chatgpt",
      sampleIdx: 1,
      raw_text: "Globex and Initech both ship an edge network.",
      citations: [],
      verdict: null,
      usage: null,
    },
    {
      runId: RUN_ID,
      qid: "q01",
      engine: "chatgpt",
      sampleIdx: 0,
      raw_text: "Acme Cloud is the one to beat for platform teams.",
      citations: [{ url: "https://reviews.example/best-edge-cdn" }],
      verdict,
      usage: { input_tokens: 1000, output_tokens: 200, searches: 1 },
    },
  ]);
  db.saveCitations([
    {
      runId: RUN_ID,
      brandId: "brand_1",
      qid: "q01",
      engine: "chatgpt",
      url: "https://reviews.example/best-edge-cdn",
      normUrl: "https://reviews.example/best-edge-cdn",
      host: "reviews.example",
      position: 0,
    },
  ]);
  await db.saveCorpusPage({
    runId: RUN_ID,
    url: "https://reviews.example/best-edge-cdn",
    final_url: "https://reviews.example/best-edge-cdn",
    title: "Best edge CDN",
    page_type: "listicle",
    cited_by: { chatgpt: 1 },
    cited_for_qids: ["q01"],
    fetch_status: 200,
    brand_present: false,
    brand_context: null,
    competitors_present: ["Globex"],
    opportunity: true,
  });
  await db.saveCheck({
    runId: RUN_ID,
    check: "robots.txt",
    status: "pass",
    detail: "every answer-engine bot is allowed",
    factor: "gates",
  });
  await db.saveFix({
    runId: RUN_ID,
    fixKey: "listicle-pitch",
    title: "Get onto the best-edge-CDN listicle",
    factor: "third-party proof",
    weight: 9,
    effort: "M",
    timeToImpact: "2-6 weeks",
    engines: ["chatgpt"],
    evidence: ["[q01] absent on chatgpt"],
    artifact: "## Pitch\n\nHello.",
  });
  await db.finishRun(RUN_ID, scores, 0.42);
  return db;
}

describe("run bundle v1", () => {
  it("projects the persisted rows into the documented top-level keys", async () => {
    const bundle = toBundle(await seed(), meta);
    expect(Object.keys(bundle)).toEqual([
      "version",
      "run",
      "brand_model",
      "questions",
      "answers",
      "citations",
      "corpus_pages",
      "domain_checks",
      "fixes",
      "scores",
      "health",
    ]);
    expect(bundle.version).toBe(BUNDLE_VERSION);
    expect(bundle.run.id).toBe(RUN_ID);
    expect(bundle.scores).toEqual(scores);
    // rows come back in the canonical types.ts shapes, not the DB column names
    expect(bundle.fixes[0].fixKey).toBe("listicle-pitch");
    expect(bundle.fixes[0].timeToImpact).toBe("2-6 weeks");
    expect(bundle.domain_checks[0].check).toBe("robots.txt");
    expect(bundle.citations[0].normUrl).toBe("https://reviews.example/best-edge-cdn");
    // raw text and EVERY sample ride along, samples in draw order
    expect(bundle.answers[0].raw_text).toContain("Acme Cloud");
    expect(bundle.answers[0].samples.map((s) => s.sampleIdx)).toEqual([0, 1]);
  });

  it("round-trips through writeBundle/readBundle unchanged", async () => {
    const bundle = toBundle(await seed(), meta);
    const json = writeBundle(bundle);
    const back = readBundle(JSON.parse(json));
    expect(back).toEqual(bundle);
    // and accepts the raw string too
    expect(readBundle(json)).toEqual(bundle);
  });

  // Samples feature: the bundle records the run-level resolution (header) AND
  // the effective per-question count (each frozen question's samples field),
  // round-tripping both losslessly.
  it("records the resolved run-level sampling and each question's effective samples count", async () => {
    const sampledMeta: BundleMeta = {
      ...meta,
      run: { ...meta.run, sampling: { samples: 3, tiebreak: false, source: "flag" } },
      questions: [
        { qid: "q01", text: "best edge CDN for platform teams", qtype: "category", samples: 3 },
        { qid: "q02", text: "is Acme Cloud any good", qtype: "branded", samples: 1 },
      ],
    };
    const bundle = toBundle(await seed(), sampledMeta);
    expect(bundle.run.sampling).toEqual({ samples: 3, tiebreak: false, source: "flag" });
    expect(bundle.questions[0].samples).toBe(3);
    expect(bundle.questions[1].samples).toBe(1);

    const back = readBundle(JSON.parse(writeBundle(bundle)));
    expect(back.run.sampling).toEqual({ samples: 3, tiebreak: false, source: "flag" });
    expect(back.questions[0].samples).toBe(3);
  });

  it("reads back an OLDER bundle with no sampling field at all (v1 is additive-only)", async () => {
    const bundle = toBundle(await seed(), meta); // meta.run has no `sampling`, questions have no `samples`
    expect(bundle.run.sampling).toBeUndefined();
    expect(bundle.questions[0].samples).toBeUndefined();
    const back = readBundle(JSON.parse(writeBundle(bundle)));
    expect(back.run.sampling).toBeUndefined();
  });

  // The bundle's run meta records which stages
  // this run skipped, round-tripping losslessly like every other header field.
  it("records skip and round-trips it through writeBundle/readBundle", async () => {
    const skippedMeta: BundleMeta = {
      ...meta,
      run: { ...meta.run, skip: { drafts: true, gates: true } },
    };
    const bundle = toBundle(await seed(), skippedMeta);
    expect(bundle.run.skip).toEqual({ drafts: true, gates: true });
    const back = readBundle(JSON.parse(writeBundle(bundle)));
    expect(back.run.skip).toEqual({ drafts: true, gates: true });
  });

  it("reads back an OLDER bundle with no skip field at all (v1 is additive-only)", async () => {
    const bundle = toBundle(await seed(), meta); // meta.run has no `skip`
    expect(bundle.run.skip).toBeUndefined();
    const back = readBundle(JSON.parse(writeBundle(bundle)));
    expect(back.run.skip).toBeUndefined();
  });

  it("accepts a string template_set_version ('<base>+custom' from a saylent.config questionTemplates override)", async () => {
    const customMeta: BundleMeta = {
      ...meta,
      run: { ...meta.run, template_set_version: "2+custom" },
      questions: [{ qid: "q01", text: "best edge CDN for platform teams", qtype: "category", source: "user" as const }],
    };
    const bundle = toBundle(await seed(), customMeta);
    const json = writeBundle(bundle);
    const back = readBundle(JSON.parse(json));
    expect(back.run.template_set_version).toBe("2+custom");
    expect(back.questions[0].source).toBe("user");
  });

  it("keeps unknown-but-present fields (forward compatible)", async () => {
    const bundle = toBundle(await seed(), meta);
    const withExtra = { ...bundle, run: { ...bundle.run, future_field: "keep me" } };
    const back = readBundle(JSON.parse(JSON.stringify(withExtra))) as unknown as {
      run: { future_field?: string };
    };
    expect(back.run.future_field).toBe("keep me");
  });

  it("refuses a bundle with a different version", async () => {
    const bundle = toBundle(await seed(), meta);
    const v2 = { ...bundle, version: 2 };
    expect(() => readBundle(v2)).toThrow(/unsupported version 2/);
    expect(() => readBundle({ ...bundle, version: undefined })).toThrow(/unsupported version/);
    expect(runBundleSchema.safeParse(v2).success).toBe(false);
  });

  it("refuses a malformed bundle with the failing path named", async () => {
    const bundle = toBundle(await seed(), meta);
    const broken = { ...bundle, fixes: [{ ...bundle.fixes[0], weight: "nine" }] };
    expect(() => readBundle(broken)).toThrow(/fixes\.0\.weight/);
    expect(() => readBundle("not json at all")).toThrow();
  });
});

// bundleFromRows: the app-side path — same underlying facts as
// seed()/meta above, but shaped as the SAME snake_case rows the app reads back
// from Postgres (dossier RPC + the flattened citations/answer_samples tables),
// with no MemoryDbWriter and no run_id column (the caller already scoped to
// one run via .eq("run_id", id) / RLS).
const rowsInput: BundleRowsInput = {
  run: meta.run,
  brand_model: meta.brand_model,
  questions: meta.questions,
  answers: [
    {
      qid: "q01",
      qtype: "category",
      question: "best edge CDN for platform teams",
      engine: "chatgpt",
      ok: true,
      raw_text: "Acme Cloud is the one to beat for platform teams.",
      citations: [{ url: "https://reviews.example/best-edge-cdn", title: "Best edge CDN" }],
      verdict,
      error: null,
      usage: { input_tokens: 1000, output_tokens: 200, searches: 1 },
    },
  ],
  samples: [
    {
      qid: "q01",
      engine: "chatgpt",
      sample_idx: 1,
      raw_text: "Globex and Initech both ship an edge network.",
      citations: [],
      verdict: null,
      usage: null,
    },
    {
      qid: "q01",
      engine: "chatgpt",
      sample_idx: 0,
      raw_text: "Acme Cloud is the one to beat for platform teams.",
      citations: [{ url: "https://reviews.example/best-edge-cdn" }],
      verdict,
      usage: { input_tokens: 1000, output_tokens: 200, searches: 1 },
    },
  ],
  citations: [
    {
      brand_id: "brand_1",
      qid: "q01",
      engine: "chatgpt",
      url: "https://reviews.example/best-edge-cdn",
      norm_url: "https://reviews.example/best-edge-cdn",
      host: "reviews.example",
      position: 0,
    },
  ],
  corpus_pages: [
    {
      url: "https://reviews.example/best-edge-cdn",
      final_url: "https://reviews.example/best-edge-cdn",
      title: "Best edge CDN",
      page_type: "listicle",
      cited_by: { chatgpt: 1 },
      cited_for_qids: ["q01"],
      fetch_status: 200,
      brand_present: false,
      brand_context: null,
      competitors_present: ["Globex"],
      opportunity: true,
      thin: false,
      page_date: null,
      contact: null,
    },
  ],
  domain_checks: [
    {
      check_name: "robots.txt",
      status: "pass",
      detail: "every answer-engine bot is allowed",
      factor: "gates",
    },
  ],
  fixes: [
    {
      fix_key: "listicle-pitch",
      title: "Get onto the best-edge-CDN listicle",
      factor: "third-party proof",
      weight: 9,
      effort: "M",
      time_to_impact: "2-6 weeks",
      engines: ["chatgpt"],
      evidence: ["[q01] absent on chatgpt"],
      artifact: "## Pitch\n\nHello.",
    },
  ],
  scores,
  health: { grade: "A", notes: [] },
};

describe("bundleFromRows (app-side rows)", () => {
  it("projects app rows into the same documented top-level keys as toBundle", () => {
    const bundle = bundleFromRows(rowsInput);
    expect(Object.keys(bundle)).toEqual([
      "version",
      "run",
      "brand_model",
      "questions",
      "answers",
      "citations",
      "corpus_pages",
      "domain_checks",
      "fixes",
      "scores",
      "health",
    ]);
    expect(bundle.version).toBe(BUNDLE_VERSION);
    expect(bundle.run).toEqual(meta.run);
    expect(bundle.brand_model).toEqual(meta.brand_model);
    expect(bundle.fixes[0].fixKey).toBe("listicle-pitch");
    expect(bundle.fixes[0].timeToImpact).toBe("2-6 weeks");
    expect(bundle.domain_checks[0].check).toBe("robots.txt");
    expect(bundle.citations[0].normUrl).toBe("https://reviews.example/best-edge-cdn");
    // raw_text and EVERY sample ride along, samples in draw order
    expect(bundle.answers[0].raw_text).toContain("Acme Cloud");
    expect(bundle.answers[0].samples.map((s) => s.sampleIdx)).toEqual([0, 1]);
  });

  it("matches toBundle's output built from the equivalent MemoryDbWriter rows", async () => {
    const fromWriter = toBundle(await seed(), meta);
    const fromRows = bundleFromRows(rowsInput);
    expect(fromRows).toEqual(fromWriter);
  });

  it("round-trips through writeBundle/readBundle and validates", () => {
    const bundle = bundleFromRows(rowsInput);
    const json = writeBundle(bundle);
    const back = readBundle(JSON.parse(json));
    expect(back).toEqual(bundle);
    expect(runBundleSchema.safeParse(bundle).success).toBe(true);
  });

  it("defaults samples/citations/scores/health when omitted", () => {
    const { samples: _s, citations: _c, scores: _sc, health: _h, ...rest } = rowsInput;
    void _s;
    void _c;
    void _sc;
    void _h;
    const bundle = bundleFromRows(rest);
    expect(bundle.answers[0].samples).toEqual([]);
    expect(bundle.citations).toEqual([]);
    expect(bundle.scores).toBeNull();
    expect(bundle.health).toBeNull();
    expect(runBundleSchema.safeParse(bundle).success).toBe(true);
  });

  it("falls back to meta.brand_model when the row doesn't carry one", () => {
    const { brand_model: _bm, ...rest } = rowsInput;
    void _bm;
    const bundle = bundleFromRows(rest, { brand_model: meta.brand_model });
    expect(bundle.brand_model).toEqual(meta.brand_model);
  });

  it("throws an honest error when brand_model is missing everywhere", () => {
    const { brand_model: _bm, ...rest } = rowsInput;
    void _bm;
    expect(() => bundleFromRows(rest)).toThrow(/brand_model is required/);
  });
});
