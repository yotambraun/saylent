// The LOSSLESS `?format=bundle` path (packages/engine/src/bundle.ts).
// Mocks the two data-loading seams: @/lib/supabase/server (createClient) and
// @/lib/dossier-data (fetchDossierViaRpc), so the test never touches a real DB.
// The plain-Supabase reads the route adds beyond the dossier (runs.question_set,
// citations, answer_samples) are faked with a minimal thenable query-builder stub —
// the same shape supabase-js query builders use (chainable, awaited directly).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runBundleSchema } from "@saylent/engine/bundle";

const mockUser: { id: string } | null = { id: "user_1" };
let dossierResult: unknown = null;
let runRow: { question_set: unknown } | null = null;
let citationsRows: unknown[] = [];
let sampleRows: unknown[] = [];
let authUser: { id: string } | null = mockUser;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => makeSupabaseStub(),
}));

vi.mock("@/lib/dossier-data", () => ({
  fetchDossierViaRpc: async () => dossierResult,
}));

// Static import — vi.mock calls above are hoisted above this by Vitest, and a
// dynamic per-test import (with vi.resetModules()) would re-execute the whole
// @saylent/engine barrel (LLM SDKs, cheerio, …) on every test, which is slow
// enough on this repo's /mnt/c filesystem to blow the default test timeout.
import { GET } from "./route";

function makeSupabaseStub() {
  return {
    auth: {
      getUser: async () => ({ data: { user: authUser } }),
    },
    from(table: string) {
      // Chainable + thenable: select/eq/order return the same builder; awaiting
      // the builder directly (Promise.all in the route) resolves via `then`;
      // .maybeSingle() resolves a single row instead.
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        maybeSingle: async () => {
          if (table === "runs") return { data: runRow, error: null };
          return { data: null, error: null };
        },
        then(resolve: (v: { data: unknown[]; error: null }) => void) {
          if (table === "citations") return resolve({ data: citationsRows, error: null });
          if (table === "answer_samples") return resolve({ data: sampleRows, error: null });
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  };
}

const verdict = {
  brand_present: true,
  mention_type: "recommended",
  prominence: "first",
  sentiment: "positive",
  claims: [],
  other_brands: [],
  excerpt: "Acme Cloud is the one to beat",
};

function seedDossier() {
  dossierResult = {
    run: {
      id: "run_1",
      kind: "audit",
      status: "done",
      profile: "full",
      created_at: "2026-09-01T00:00:00.000Z",
      finished_at: "2026-09-01T00:05:00.000Z",
      share_token: null,
      scores: { overall: { answered: 2, recommended: 1 } },
      est_cost_usd: 0.42,
      baseline_run_id: null,
      error: null,
      health: { grade: "A", notes: [] },
      brand_model: {
        brand: "Acme Cloud",
        domain: "acme.example",
        aliases: ["Acme"],
        category: "edge CDN",
        icp: "platform teams",
        products: ["Edge CDN"],
        value_props: ["global cache"],
        problems: ["slow global page loads"],
        competitors: ["Globex"],
        language: "en",
        confidence: "ok",
      },
    },
    brand: { name: "Acme Cloud", domain: "acme.example", aliases: ["Acme"], competitors: ["Globex"], authorized_at: null },
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
        usage: { input_tokens: 1000, output_tokens: 200 },
      },
      {
        qid: "q02",
        qtype: "category",
        question: "alternatives to Globex",
        engine: "claude",
        ok: true,
        raw_text: "Consider Acme Cloud alongside Globex.",
        citations: [],
        verdict: null,
        error: null,
        usage: null,
      },
    ],
    corpus: [],
    checks: [
      { check_name: "robots.txt", status: "pass", detail: "every answer-engine bot is allowed", factor: "gates" },
    ],
    fixes: [],
    previous: null,
  };
  runRow = {
    question_set: {
      questions: [
        { qid: "q01", text: "best edge CDN for platform teams", qtype: "category" },
        { qid: "q02", text: "alternatives to Globex", qtype: "category" },
      ],
      version: 3,
      engines: ["chatgpt", "claude"],
    },
  };
  citationsRows = [
    {
      qid: "q01",
      engine: "chatgpt",
      url: "https://reviews.example/best-edge-cdn",
      norm_url: "https://reviews.example/best-edge-cdn",
      host: "reviews.example",
      position: 0,
      brand_id: "brand_1",
    },
  ];
  sampleRows = [];
}

async function callGet(url: string) {
  return GET(new Request(url), { params: Promise.resolve({ id: "run_1" }) });
}

describe("GET /api/runs/[id]/export?format=bundle", () => {
  beforeEach(() => {
    authUser = mockUser;
    seedDossier();
  });

  it("returns a valid, lossless bundle with raw_text on every answer", async () => {
    const res = await callGet("https://app.saylent.example/api/runs/run_1/export?format=bundle");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toMatch(/filename="acme-cloud-\d{4}-\d{2}-\d{2}\.run\.json"/);

    const body = await res.json();
    const parsed = runBundleSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body.answers).toHaveLength(2);
    for (const a of body.answers) {
      expect(typeof a.raw_text).toBe("string");
      expect(a.raw_text.length).toBeGreaterThan(0);
    }
    // the frozen envelope + citations reads landed
    expect(body.run.engines).toEqual(["chatgpt", "claude"]);
    expect(body.run.question_set_version).toBe(3);
    expect(body.questions).toHaveLength(2);
    expect(body.citations[0].host).toBe("reviews.example");
    expect(body.brand_model.icp).toBe("platform teams");
    expect(body.domain_checks[0].check).toBe("robots.txt");
  });

  it("401s when unauthenticated", async () => {
    authUser = null;
    const res = await callGet("https://app.saylent.example/api/runs/run_1/export?format=bundle");
    expect(res.status).toBe(401);
  });

  it("404s when the run is missing / not owned", async () => {
    dossierResult = null;
    const res = await callGet("https://app.saylent.example/api/runs/run_1/export?format=bundle");
    expect(res.status).toBe(404);
  });

  it("409s when the run has not finished", async () => {
    (dossierResult as { run: { status: string } }).run.status = "running";
    const res = await callGet("https://app.saylent.example/api/runs/run_1/export?format=bundle");
    expect(res.status).toBe(409);
  });

  it("falls back to a minimal brand_model and re-derives questions from answers for a pre-0034 run", async () => {
    (dossierResult as { run: Record<string, unknown> }).run.brand_model = undefined;
    runRow = { question_set: null };
    const res = await callGet("https://app.saylent.example/api/runs/run_1/export?format=bundle");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(runBundleSchema.safeParse(body).success).toBe(true);
    expect(body.brand_model.brand).toBe("Acme Cloud");
    expect(body.questions.map((q: { qid: string }) => q.qid)).toEqual(["q01", "q02"]);
    expect(body.run.question_set_version).toBe(1);
  });
});
