// reportDataFromBundle — pure mapping, $0. The bundle it maps from is produced
// by the SAME fake pipeline run-audit.test.ts and bundle.test.ts use (a
// MemoryDbWriter seeded through toBundle), so this proves the mapping against
// data shaped exactly like what a real (or fake-adapter) run produces.
import { toBundle, type BundleMeta } from "@saylent/engine/bundle";
import { MemoryDbWriter } from "@saylent/engine/memory-writer";
import type { Scores, Verdict } from "@saylent/engine/types";
import { describe, expect, it } from "vitest";
import { reportDataFromBundle } from "./from-bundle";

const RUN_ID = "run_frombundle_1";

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
    engines: ["chatgpt"],
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

describe("reportDataFromBundle", () => {
  it("maps run/brand/scores from the bundle header", async () => {
    const bundle = toBundle(await seed(), meta);
    const data = reportDataFromBundle(bundle);
    expect(data.run.id).toBe(RUN_ID);
    expect((data.run as unknown as { kind: string }).kind).toBe("audit");
    expect((data.run as unknown as { status: string }).status).toBe("done");
    expect((data.run as unknown as { stage: string }).stage).toBe("done");
    expect((data.run as unknown as { profile: string }).profile).toBe("smoke");
    expect((data.run as unknown as { scores: unknown }).scores).toEqual(scores);
    expect((data.run as unknown as { est_cost_usd: number }).est_cost_usd).toBe(0.42);
    expect(data.run.finished_at).toBe("2026-09-09T10:03:00.000Z");
    expect(data.brand).toEqual({
      name: "Acme Cloud",
      domain: "acme.example",
      aliases: ["Acme Cloud", "Acme"],
      competitors: ["Globex"],
      authorized_at: null,
    });
  });

  it("carries health and brand_model through for the Brief composer", async () => {
    const bundle = toBundle(await seed(), meta);
    const data = reportDataFromBundle(bundle);
    const run = data.run as unknown as { health: unknown; brand_model: unknown; site_pages: unknown };
    expect(run.health).toEqual({ grade: "A", notes: [] });
    expect(run.brand_model).toEqual(meta.brand_model);
    expect(run.site_pages).toBeNull();
  });

  it("assigns stable synthetic ids to answers/corpus/checks/fixes", async () => {
    const bundle = toBundle(await seed(), meta);
    const data = reportDataFromBundle(bundle);
    expect(data.answers[0].id).toBe("a000");
    expect(data.corpus[0].id).toBe("p000");
    expect(data.checks[0].id).toBe("c000");
    expect(data.fixes[0].id).toBe("f000");
  });

  it("maps an answer's engine columns and every sampled draw verbatim", async () => {
    const bundle = toBundle(await seed(), meta);
    const data = reportDataFromBundle(bundle);
    const a = data.answers[0];
    expect(a.qid).toBe("q01");
    expect(a.engine).toBe("chatgpt");
    expect(a.ok).toBe(true);
    expect(a.raw_text).toContain("Acme Cloud");
    expect(a.verdict?.mention_type).toBe("recommended");
    expect(a.created_at).toBe("2026-09-09T10:03:00.000Z"); // finished_at (no per-answer timestamp in the bundle)
  });

  it("maps corpus, checks and fixes field-for-field (DB column names, not engine names)", async () => {
    const bundle = toBundle(await seed(), meta);
    const data = reportDataFromBundle(bundle);
    expect(data.corpus[0].cited_by).toEqual({ chatgpt: 1 });
    expect(data.corpus[0].thin).toBe(false);
    expect(data.checks[0].check_name).toBe("robots.txt");
    expect(data.checks[0].factor).toBe("gates");
    expect(data.fixes[0].fix_key).toBe("listicle-pitch");
    expect(data.fixes[0].time_to_impact).toBe("2-6 weeks");
    expect(data.fixes[0].artifact).toBe("## Pitch\n\nHello.");
  });

  it("falls back to started_at when finished_at is null", async () => {
    // Built as a literal (not via toBundle+MemoryDbWriter.finishRun, which
    // always stamps a real finished_at) so finished_at is genuinely absent —
    // the case a still-running or never-finished bundle would have on disk.
    const bundle = toBundle(await seed(), meta);
    bundle.run.finished_at = null;
    const data = reportDataFromBundle(bundle);
    expect(data.answers[0].created_at).toBe("2026-09-09T10:00:00.000Z");
    expect(data.run.finished_at).toBeNull();
  });

  it("reports a failed run's stage as its failure reason", async () => {
    const bundle = toBundle(await seed(), {
      ...meta,
      run: { ...meta.run, status: "failed", failure: "internal call-cap guard" },
    });
    const data = reportDataFromBundle(bundle);
    expect((data.run as unknown as { stage: string }).stage).toBe("internal call-cap guard");
    expect((data.run as unknown as { error: string }).error).toBe("internal call-cap guard");
  });
});
