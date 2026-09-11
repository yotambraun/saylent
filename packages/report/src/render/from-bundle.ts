// The CLI's report rendering (see ARCHITECTURE.md), via the
// report package's own render pipeline: reportDataFromBundle(bundle) turns the
// LOSSLESS run.json (@saylent/engine/bundle RunBundleV1) into the exact
// ReportData shape renderReportHtml / renderMarkdown / renderMovementHtml
// already take — the same shape get_dossier hands the Next app (render/types.ts).
// Pure mapping: no LLM, no network, no filesystem. Synthetic row ids are
// assigned (the bundle carries no DB ids) exactly the way
// scripts/capture-fixture.ts's fixtureToReportData does for the $0 fixture
// pipeline, so a receipt drawer resolves identically either way.
import type { RunBundleV1 } from "@saylent/engine/bundle";
import type { ReportData } from "./types";

export function reportDataFromBundle(bundle: RunBundleV1): ReportData {
  const finishedAt = bundle.run.finished_at ?? bundle.run.started_at;

  const answers = bundle.answers.map((a, i) => ({
    id: `a${String(i).padStart(3, "0")}`,
    qid: a.qid,
    qtype: a.qtype,
    question: a.question,
    engine: a.engine,
    ok: a.ok,
    raw_text: a.raw_text,
    citations: a.citations,
    verdict: a.verdict ?? null,
    error: a.error ?? null,
    created_at: finishedAt,
    usage: a.usage ?? null,
  }));

  const corpus = bundle.corpus_pages.map((p, i) => ({
    id: `p${String(i).padStart(3, "0")}`,
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
  }));

  const checks = bundle.domain_checks.map((c, i) => ({
    id: `c${String(i).padStart(3, "0")}`,
    check_name: c.check,
    status: c.status,
    detail: c.detail,
    factor: c.factor ?? null,
  }));

  const fixes = bundle.fixes.map((f, i) => ({
    id: `f${String(i).padStart(3, "0")}`,
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
  }));

  // RunRow (types.ts) declares only the DB columns the app's live poll reads;
  // brief.ts/renderMarkdown.ts read a few MORE fields (health, brand_model,
  // site_pages) off the same object via a cast, exactly like
  // fixtureToReportData's `run` object — so those ride along here too, then
  // the whole ReportData is cast at the end (same convention as fixture.ts).
  const run = {
    id: bundle.run.id,
    kind: bundle.run.kind,
    status: bundle.run.status,
    stage: bundle.run.status === "done" ? "done" : (bundle.run.failure ?? "failed"),
    profile: bundle.run.profile,
    scores: bundle.scores,
    est_cost_usd: bundle.run.est_cost_usd,
    error: bundle.run.failure ?? null,
    created_at: bundle.run.started_at,
    finished_at: bundle.run.finished_at,
    // extra, cast-only fields (see brief.ts / render/markdown.ts):
    health: bundle.health,
    brand_model: bundle.brand_model,
    // the bundle does not carry the crawled site pages (RunBundleV1 has no
    // sitePages field) — the Brief's "own site coverage" card degrades to
    // "not recorded" rather than a fabricated empty crawl.
    site_pages: null,
  };

  const brand = {
    name: bundle.brand_model.brand,
    domain: bundle.brand_model.domain,
    aliases: bundle.brand_model.aliases,
    competitors: bundle.brand_model.competitors,
    // a CLI run has no DB-tracked authorization timestamp
    authorized_at: null,
  };

  return {
    run,
    brand,
    answers,
    corpus,
    checks,
    fixes,
    previous: null,
  } as unknown as ReportData;
}
