// The converter is what lets ONE run — the pseudonymized public sample,
// examples/kestrel/run.json — be the demo, the $0 local rig and the committed
// fixture at the same time. If it drops or reshapes a field, the demo quietly
// shows different numbers than the sample a reader downloads, which is exactly
// the drift this file exists to catch.
//
// The proof is a ROUND TRIP on the real bundle: bundle -> DB rows
// (bundleToFixture, what seed-demo.ts / seed-fixture-run.ts insert) -> bundle
// (bundleFromRows, what the app's export route uses to rebuild run.json), then
// a field-by-field comparison of the parts a reader actually reads.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bundleFromRows, readBundle, type RunBundleV1 } from "@saylent/engine/bundle";
import { bundleToFixture, type CapturedFixture } from "./bundle-to-fixture";

const SAMPLE = "examples/kestrel/run.json";

const bundle: RunBundleV1 = readBundle(JSON.parse(readFileSync(SAMPLE, "utf8")));
const fixture: CapturedFixture = bundleToFixture(bundle);

/** rows -> bundle, the direction the app's export route takes. The fixture
 *  deliberately carries no run header (a DB row set has none), so the header
 *  pieces come back from the original bundle; everything compared below is
 *  carried by the ROWS. */
const roundTripped: RunBundleV1 = bundleFromRows({
  run: bundle.run,
  brand_model: {
    brand: fixture.brand.name,
    domain: fixture.brand.domain,
    aliases: fixture.brand.aliases,
    category: fixture.brand.category,
    icp: fixture.brand.icp,
    competitors: fixture.brand.competitors,
    problems: fixture.brand.problems,
  } as RunBundleV1["brand_model"],
  questions: fixture.brand.question_set.questions as RunBundleV1["questions"],
  answers: fixture.answers as never,
  corpus_pages: fixture.corpus_pages as never,
  domain_checks: fixture.domain_checks as never,
  fixes: fixture.fixes as never,
  scores: fixture.run.scores as RunBundleV1["scores"],
});

describe("bundleToFixture — the sample bundle survives the round trip", () => {
  it("keeps every answer, in order, with the same text", () => {
    expect(roundTripped.answers).toHaveLength(bundle.answers.length);
    for (const [i, before] of bundle.answers.entries()) {
      const after = roundTripped.answers[i];
      expect(after.qid).toBe(before.qid);
      expect(after.engine).toBe(before.engine);
      expect(after.qtype).toBe(before.qtype);
      expect(after.question).toBe(before.question);
      expect(after.ok).toBe(before.ok);
      expect(after.raw_text).toBe(before.raw_text);
      expect(after.verdict ?? null).toEqual(before.verdict ?? null);
      expect(after.error ?? null).toEqual(before.error ?? null);
      expect(after.usage ?? null).toEqual(before.usage ?? null);
    }
  });

  it("keeps every citation on every answer, with its position", () => {
    for (const [i, before] of bundle.answers.entries()) {
      expect(roundTripped.answers[i].citations).toEqual(before.citations);
    }
    // and the flattened citations table is still derivable from them: the
    // report's "which page did this engine cite" receipt is built from these.
    const flat = bundle.citations.map((c) => `${c.qid}|${c.engine}|${c.url}`).sort();
    const fromRows = roundTripped.answers
      .flatMap((a) => a.citations.map((c) => `${a.qid}|${a.engine}|${c.url}`))
      .sort();
    expect(fromRows).toEqual(flat);
  });

  it("keeps every domain check, field by field", () => {
    expect(roundTripped.domain_checks).toHaveLength(bundle.domain_checks.length);
    for (const [i, before] of bundle.domain_checks.entries()) {
      const after = roundTripped.domain_checks[i];
      expect(after.check).toBe(before.check);
      expect(after.status).toBe(before.status);
      expect(after.detail).toBe(before.detail);
      expect(after.factor ?? null).toBe(before.factor ?? null);
    }
  });

  it("keeps every fix, field by field, including its drafted artifact", () => {
    expect(roundTripped.fixes).toHaveLength(bundle.fixes.length);
    for (const [i, before] of bundle.fixes.entries()) {
      const after = roundTripped.fixes[i];
      expect(after.fixKey).toBe(before.fixKey);
      expect(after.title).toBe(before.title);
      expect(after.factor).toBe(before.factor);
      expect(after.weight).toBe(before.weight);
      expect(after.effort).toBe(before.effort);
      expect(after.timeToImpact).toBe(before.timeToImpact);
      expect(after.engines).toEqual(before.engines);
      expect(after.evidence).toEqual(before.evidence);
      expect(after.artifact ?? null).toEqual(before.artifact ?? null);
    }
  });

  it("keeps the scores object identical — the verdict a reader compares", () => {
    expect(roundTripped.scores).toEqual(bundle.scores);
    const overall = (bundle.scores as { overall: { answered: number; recommended: number } }).overall;
    // the numbers the demo, the README and the sample must all agree on
    expect(fixture.run.scores).toEqual(bundle.scores);
    expect(overall.answered).toBeGreaterThan(0);
  });

  it("keeps the corpus pages and the frozen question set", () => {
    expect(roundTripped.corpus_pages.map((p) => p.url)).toEqual(bundle.corpus_pages.map((p) => p.url));
    for (const [i, before] of bundle.corpus_pages.entries()) {
      const after = roundTripped.corpus_pages[i];
      expect(after.title).toBe(before.title);
      expect(after.cited_by).toEqual(before.cited_by);
      expect(after.cited_for_qids).toEqual(before.cited_for_qids);
      expect(after.opportunity).toEqual(before.opportunity);
    }
    expect(fixture.brand.question_set.questions.map((q) => q.text)).toEqual(
      bundle.questions.map((q) => q.text),
    );
  });

  it("carries the brand model the questions were generated from", () => {
    expect(fixture.brand.name).toBe(bundle.brand_model.brand);
    expect(fixture.brand.domain).toBe(bundle.brand_model.domain);
    expect(fixture.brand.competitors).toEqual(bundle.brand_model.competitors);
    expect(fixture.brand.problems).toEqual(bundle.brand_model.problems);
    expect(roundTripped.brand_model.competitors).toEqual(bundle.brand_model.competitors);
  });

  it("does not carry the unfilled-slot competitor placeholder anywhere", () => {
    // packages/engine COMPETITOR_FALLBACK reads as a bug in a screenshot
    // ("… alternatives to the leading alternative"). The public sample names
    // real pseudonymized rivals, and the demo seeds from this same file.
    expect(JSON.stringify(fixture)).not.toContain("the leading alternative");
  });

  it("dates the run row from the bundle, so every surface prints one date", () => {
    expect(fixture.run.created_at).toBe(bundle.run.started_at);
    expect(fixture.run.finished_at).toBe(bundle.run.finished_at);
    expect(fixture.run.est_cost_usd).toBe(bundle.run.est_cost_usd);
  });

  it("strips the generated fts column Postgres refuses on insert", () => {
    for (const f of fixture.fixes) expect(f).not.toHaveProperty("fts");
    for (const a of fixture.answers) expect(a).not.toHaveProperty("fts");
  });
});
