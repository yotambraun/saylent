// Operator/dev use: turns a run BUNDLE (RunBundleV1 — packages/engine/src/
// bundle.ts, what `saylent audit` writes as run.json) into the DB-ROW-shaped
// fixture scripts/seed-fixture-run.ts / scripts/simulate-run.ts and the
// render/fixture.ts golden test expect (fixtures/run.json — the SAME payload
// shape scripts/capture-fixture.ts exports from a live Supabase run: no DB
// ids, run.{kind,status,profile,stage,scores,est_cost_usd,finished_at} only).
//
// Why this exists rather than reusing capture-fixture.ts: capture-fixture.ts
// reads a LIVE Supabase run; this reads a bundle file (the pseudonymized
// public sample, examples/kestrel/run.json) so fixtures/run.json can be
// regenerated from the same one real run with zero drift and no database.
//
// Usage:
//   npx tsx --tsconfig scripts/tsconfig.json scripts/bundle-to-fixture.ts \
//     <in.run.json> <out/fixture.json>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { readBundle, type RunBundleV1 } from "@saylent/engine/bundle";

/** The captured-fixture shape (scripts/capture-fixture.ts's `out`, what
 *  seed-fixture-run.ts inserts and render/fixture.ts#fixtureToReportData
 *  reads back). Kept structurally identical to the file it replaces. */
export interface CapturedFixture {
  captured_at: string;
  run: {
    kind: string;
    status: string;
    profile: string;
    stage: string;
    scores: unknown;
    est_cost_usd: number | null;
    /** runs.created_at. Seeded from the bundle's own start time (rather than
     *  left to the table's `default now()`) so the dashboard's run date, the
     *  report header and the sample bundle all print ONE date for one run. */
    created_at: string;
    finished_at: string | null;
  };
  brand: {
    name: string;
    domain: string;
    aliases: string[];
    category: string;
    icp: string;
    competitors: string[];
    problems: string[];
    question_set: { version: number | string; questions: { qid: string; text: string; qtype: string }[] };
  };
  answers: Record<string, unknown>[];
  corpus_pages: Record<string, unknown>[];
  domain_checks: Record<string, unknown>[];
  fixes: Record<string, unknown>[];
}

/** Pure transform, exported for tests: bundle → the captured-fixture shape.
 *  Mirrors capture-fixture.ts's `strip` (no id/run_id/user_id/brand_id — a
 *  bundle never carries those anyway) and the exact MemoryAnswerRow /
 *  MemoryCorpusPageRow / MemoryDomainCheckRow / MemoryFixRow column sets
 *  (memory-writer.ts) capture-fixture.ts's `select("*")` would return. */
export function bundleToFixture(bundle: RunBundleV1): CapturedFixture {
  const stage = bundle.run.status === "done" ? "done" : (bundle.run.failure ?? "failed");

  return {
    captured_at: bundle.run.finished_at ?? bundle.run.started_at,
    run: {
      kind: bundle.run.kind,
      status: bundle.run.status,
      profile: bundle.run.profile,
      stage,
      scores: bundle.scores,
      est_cost_usd: bundle.run.est_cost_usd,
      created_at: bundle.run.started_at,
      finished_at: bundle.run.finished_at,
    },
    brand: {
      name: bundle.brand_model.brand,
      domain: bundle.brand_model.domain,
      aliases: bundle.brand_model.aliases,
      category: bundle.brand_model.category,
      icp: bundle.brand_model.icp,
      competitors: bundle.brand_model.competitors,
      problems: bundle.brand_model.problems,
      question_set: {
        version: bundle.run.question_set_version,
        questions: bundle.questions.map((q) => ({ qid: q.qid, text: q.text, qtype: q.qtype })),
      },
    },
    answers: bundle.answers.map((a) => ({
      qid: a.qid,
      qtype: a.qtype,
      question: a.question,
      engine: a.engine,
      ok: a.ok,
      raw_text: a.raw_text,
      citations: a.citations,
      verdict: a.verdict ?? null,
      error: a.error ?? null,
      usage: a.usage ?? null,
    })),
    corpus_pages: bundle.corpus_pages.map((p) => ({
      url: p.url,
      final_url: p.final_url,
      title: p.title,
      page_type: p.page_type,
      cited_by: p.cited_by,
      cited_for_qids: p.cited_for_qids,
      fetch_status: p.fetch_status,
      brand_present: p.brand_present,
      brand_context: p.brand_context,
      competitors_present: p.competitors_present,
      opportunity: p.opportunity,
      thin: p.thin ?? false,
    })),
    domain_checks: bundle.domain_checks.map((c) => ({
      check_name: c.check,
      status: c.status,
      detail: c.detail,
      factor: c.factor ?? null,
    })),
    fixes: bundle.fixes.map((f) => ({
      fix_key: f.fixKey,
      title: f.title,
      factor: f.factor,
      weight: f.weight,
      effort: f.effort,
      time_to_impact: f.timeToImpact,
      engines: f.engines,
      evidence: f.evidence,
      artifact: f.artifact ?? null,
      published_at: null,
      // NOTE: the real DB row also carries `fts`, a Postgres GENERATED
      // (tsvector) column returned by capture-fixture.ts's `select("*")`.
      // It cannot be authentically reproduced outside Postgres, nothing
      // reads it from fixtures/run.json, and seed-fixture-run.ts/
      // simulate-run.ts both strip it before insert anyway — so it is
      // deliberately omitted here rather than faked.
    })),
  };
}

function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    throw new Error("usage: bundle-to-fixture.ts <in.run.json> <out/fixture.json>");
  }
  const raw = JSON.parse(readFileSync(input, "utf8"));
  const bundle = readBundle(raw);
  const fixture = bundleToFixture(bundle);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(fixture, null, 1)}\n`);
  console.log(
    `bundle-to-fixture: ${input} → ${output} ` +
      `(answers=${fixture.answers.length} corpus_pages=${fixture.corpus_pages.length} ` +
      `domain_checks=${fixture.domain_checks.length} fixes=${fixture.fixes.length})`,
  );
}

if (process.argv[1] && /bundle-to-fixture\.ts$/.test(process.argv[1])) {
  main();
}
