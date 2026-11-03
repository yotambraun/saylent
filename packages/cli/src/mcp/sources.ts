// The MCP `sources` tool ($0): query a run.json's source intelligence —
// citation share, share of voice and off-site opportunities — with receipts.
// The numbers are the bundle's own `sources` block when its schema is one this
// build reads, otherwise recomputed from the bundle's rows by the same engine
// function (@saylent/engine/sources), so an agent and the report never see two
// different lists. Also backs `saylent sources` (commands/sources.ts).
import type { RunBundleV1 } from "@saylent/engine/bundle";
import {
  DOMAIN_TYPES,
  DOMAIN_TYPE_LABEL,
  type DomainType,
  type SourceIntelligence,
  type SourceOverrides,
} from "@saylent/engine/sources";
import { sourceIntelFor } from "@saylent/report/data-export";
import { engineLabel } from "@saylent/engine/surfaces";

export const SOURCE_VIEWS = ["summary", "opportunities", "domains", "voice", "all"] as const;
export type SourceView = (typeof SOURCE_VIEWS)[number];

export interface SourcesQuery {
  view?: SourceView;
  /** keep only rows cited by (or naming, for voice) this engine/surface */
  engine?: string;
  /** keep only domains/opportunities of this type */
  type?: DomainType;
  /** one domain's full detail: pages, every answer citing it, its opportunity */
  domain?: string;
  /** rows per list (default 10, max 50) */
  limit?: number;
}

/** The bundle's source intelligence: stored when readable, else recomputed
 *  (one implementation, shared with the export tables). */
export function intelFor(bundle: RunBundleV1, overrides?: SourceOverrides | null): { intel: SourceIntelligence; recomputed: boolean } {
  return sourceIntelFor(bundle, overrides);
}

/** A short, quotable excerpt of one answer (the receipt's own words). */
function excerptOf(bundle: RunBundleV1, qid: string, engine: string): string {
  const a = bundle.answers.find((x) => x.qid === qid && x.engine === engine);
  const text = (a?.raw_text ?? "").replace(/\s+/g, " ").trim();
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

/** The compact digest the audit tool returns next to its summary blocks. */
export function sourcesDigest(intel: SourceIntelligence) {
  return {
    schema_version: intel.schema_version,
    totals: intel.totals,
    top_domains: intel.domains.slice(0, 5).map((d) => ({
      host: d.host,
      type: d.type,
      citations: d.citations,
    })),
    opportunities: intel.opportunities.slice(0, 3).map((o) => ({
      host: o.host,
      type: o.type,
      evidence: o.evidence,
      why: o.why,
    })),
  };
}

export function querySources(bundle: RunBundleV1, q: SourcesQuery, overrides?: SourceOverrides | null) {
  const { intel, recomputed } = intelFor(bundle, overrides);
  const view: SourceView = q.view ?? "summary";
  const limit = Math.max(1, Math.min(50, q.limit ?? 10));
  if (q.type && !(DOMAIN_TYPES as readonly string[]).includes(q.type)) {
    throw new Error(`Unknown type "${q.type}". Types: ${DOMAIN_TYPES.join(", ")}.`);
  }
  const engines = intel.engines.map((e) => e.engine);
  if (q.engine && !engines.includes(q.engine)) {
    throw new Error(`This run has no answers from "${q.engine}". Engines in this run: ${engines.join(", ")}.`);
  }
  const byEngine = (counts: Record<string, number>) => !q.engine || (counts[q.engine] ?? 0) > 0;
  const byType = (t: DomainType) => !q.type || t === q.type;

  const domains = intel.domains.filter((d) => byEngine(d.byEngine) && byType(d.type));
  const opportunities = intel.opportunities.filter((o) => (!q.engine || o.engines.includes(q.engine)) && byType(o.type));
  const voice = intel.voice.filter((v) => !q.engine || (v.byEngine[q.engine] ?? 0) > 0 || v.isBrand);

  const opportunityRows = opportunities.slice(0, limit).map((o) => ({
    host: o.host,
    type: o.type,
    type_label: DOMAIN_TYPE_LABEL[o.type],
    type_rule: o.typeRule,
    evidence: o.evidence,
    engines: o.engines,
    rivals: o.rivals,
    page_check: o.pageCheck,
    brand_named_answers: o.brandNamedAnswers,
    why: o.why,
    top_page: o.topPage,
    receipts: o.receipts.map((r) => ({
      qid: r.qid,
      engine: r.engine,
      engine_label: engineLabel(r.engine),
      question: r.question,
      cited_urls: r.urls,
      rivals_named: r.rivals,
      answer_excerpt: excerptOf(bundle, r.qid, r.engine),
    })),
  }));
  const domainRows = domains.slice(0, limit).map((d) => ({
    host: d.host,
    type: d.type,
    type_rule: d.typeRule,
    citations: d.citations,
    share: Math.round(d.share * 1000) / 1000,
    answers: d.answers,
    by_engine: d.byEngine,
    brand_named_answers: d.brandNamedAnswers,
    rival_won_answers: d.rivalWonAnswers,
  }));
  const voiceRows = voice.slice(0, limit).map((v) => ({
    name: v.name,
    is_brand: v.isBrand,
    named: v.named,
    recommended: v.recommended,
    by_engine: v.byEngine,
    receipts: v.refs,
  }));

  let domainDetail: unknown = undefined;
  if (q.domain) {
    const host = q.domain.trim().toLowerCase().replace(/^www\./, "");
    const d = intel.domains.find((x) => x.host === host);
    if (!d) throw new Error(`No answer in this run cites ${host}.`);
    domainDetail = {
      ...d,
      type_label: DOMAIN_TYPE_LABEL[d.type],
      opportunity: intel.opportunities.find((o) => o.host === host) ?? null,
      answers: d.refs.map((r) => ({
        qid: r.qid,
        engine: r.engine,
        question: bundle.answers.find((a) => a.qid === r.qid && a.engine === r.engine)?.question ?? "",
        answer_excerpt: excerptOf(bundle, r.qid, r.engine),
      })),
    };
  }

  const want = (v: SourceView) => view === v || view === "all";
  return {
    schema_version: intel.schema_version,
    recomputed,
    totals: intel.totals,
    engines: intel.engines,
    by_type: intel.byType,
    ...(view === "summary"
      ? {
          top_domains: domainRows.slice(0, 5),
          opportunities: opportunityRows.slice(0, 3).map(({ receipts, ...o }) => ({ ...o, receipts: receipts.slice(0, 2) })),
          voice: voiceRows.slice(0, 5).map(({ receipts, ...v }) => ({ ...v, receipts: receipts.length })),
        }
      : {}),
    ...(want("opportunities") ? { opportunities: opportunityRows } : {}),
    ...(want("domains") ? { domains: domainRows } : {}),
    ...(want("voice") ? { voice: voiceRows } : {}),
    ...(domainDetail ? { domain_detail: domainDetail } : {}),
    overrides: intel.overrides,
  };
}
