// Data out: one versioned, documented set of flat tables built from run
// bundles (run.json) and, optionally, an AI-crawler report (crawlers.json).
// The CLI (`saylent export`), the MCP `export` tool, the app's Export menu and
// the read-only API all call buildDataExport, so a column means the same thing
// wherever it is downloaded.
//
// Every number is a count read from the bundle or the crawler report; nothing
// is estimated. Source tables use the bundle's stored `sources` block when this
// build reads its schema, else recompute it with the same engine function the
// report uses (@saylent/engine/sources).
//
// VERSIONING: EXPORT_COLUMNS is the contract. Adding a column at the END of a
// table, or a new table at the END of the list, is a minor change and keeps
// export_format; renaming, removing or reordering a column or table bumps
// EXPORT_SCHEMA_VERSION (data-export.test.ts pins both). Additions since v1
// first shipped are listed in EXPORT_ADDITIONS and in export.mdx.
import type { RunBundleV1 } from "@saylent/engine/bundle";
import type { CrawlerReport } from "@saylent/engine/crawler-analytics";
import {
  buildSourceIntelligence,
  readStoredSources,
  sourceHost,
  type SourceIntelligence,
  type SourceOverrides,
} from "@saylent/engine/sources";
import { engineLabel, isNotShownRow } from "@saylent/engine/surfaces";
import { toCsv } from "./run-export";

export const EXPORT_SCHEMA_VERSION = 1;
export const EXPORT_FORMAT = `saylent.export/v${EXPORT_SCHEMA_VERSION}` as const;

export const EXPORT_COLUMNS = {
  runs: [
    "run_id", "run_date", "kind", "profile", "brand", "domain", "engines", "models",
    "judge_mode", "questions", "answers", "scored_answers", "recommended", "mentioned",
    "est_cost_usd", "baseline_run_id",
  ],
  answers: [
    "run_id", "run_date", "qid", "qtype", "question", "engine", "engine_label", "status",
    "brand_present", "mention_type", "prominence", "sentiment", "rivals_named", "citations",
    "citation_urls", "samples", "excerpt", "answer_text", "search_queries",
  ],
  citations: [
    "run_id", "run_date", "qid", "engine", "position", "url", "host", "page_title",
    "page_type", "brand_on_page", "rivals_on_page",
  ],
  sources: [
    "run_id", "run_date", "host", "type", "type_rule", "citations", "share", "answers",
    "brand_named_answers", "rival_won_answers", "engines",
  ],
  opportunities: [
    "run_id", "run_date", "rank", "host", "type", "evidence", "engines", "rivals",
    "page_check", "brand_named_answers", "top_page_url", "why", "receipts",
  ],
  share_of_voice: ["run_id", "run_date", "name", "is_brand", "scope", "named", "recommended", "receipts"],
  fixes: [
    "run_id", "run_date", "rank", "fix_key", "title", "factor", "weight", "effort", "engines",
    "evidence", "has_artifact",
  ],
  crawlers: [
    "window_from", "window_to", "bot_id", "bot", "operator", "purpose", "ai", "requests", "pages",
    "blocked", "server_errors", "not_found", "verified", "unverified", "first_seen", "last_seen",
  ],
  search_queries: ["run_id", "run_date", "qid", "engine", "sample", "position", "query"],
  ai_referrals: [
    "window_from", "window_to", "assistant_id", "assistant", "operator", "visits", "via_referrer",
    "via_utm_source", "top_pages", "first_seen", "last_seen",
  ],
} as const;

/** What v1 gained after it first shipped, oldest first. Each is additive: a
 *  reader written for the earlier columns keeps working. */
export const EXPORT_ADDITIONS = [
  { version: "0.2.0", change: "answers.search_queries (last column) and the search_queries table: the web searches each engine reported running" },
  { version: "0.2.0", change: "the ai_referrals table: visits AI assistants sent, from a crawlers.json made by 0.2.0 or later" },
] as const;

export type ExportTable = keyof typeof EXPORT_COLUMNS;
export const EXPORT_TABLES = Object.keys(EXPORT_COLUMNS) as ExportTable[];

export type Cell = string | number | boolean | null | string[];
export type ExportRow = Record<string, Cell>;

export interface DataExport {
  export_format: typeof EXPORT_FORMAT;
  schema_version: typeof EXPORT_SCHEMA_VERSION;
  generated_at: string;
  /** the column order of every table, as published in the docs */
  columns: { [T in ExportTable]: readonly string[] };
  tables: { [T in ExportTable]: ExportRow[] };
  notes: string[];
}

export interface DataExportInput {
  bundles: RunBundleV1[];
  crawlers?: CrawlerReport | null;
  /** a brand's source-type corrections; when set, sources are recomputed */
  overrides?: SourceOverrides | null;
  /** fixed clock for tests */
  now?: Date;
}

export function isExportTable(v: string): v is ExportTable {
  return (EXPORT_TABLES as string[]).includes(v);
}

/** The bundle's source intelligence: the stored block when readable, else
 *  recomputed from its own rows. */
export function sourceIntelFor(bundle: RunBundleV1, overrides?: SourceOverrides | null): { intel: SourceIntelligence; recomputed: boolean } {
  const stored = overrides ? null : readStoredSources(bundle.sources);
  if (stored) return { intel: stored, recomputed: false };
  const intel = buildSourceIntelligence({
    brand: {
      name: bundle.brand_model.brand || bundle.run.brand.name,
      domain: bundle.brand_model.domain || bundle.run.brand.domain,
      aliases: bundle.brand_model.aliases,
      competitors: bundle.brand_model.competitors,
    },
    answers: bundle.answers,
    corpus: bundle.corpus_pages,
    overrides: overrides ?? bundle.sources?.overrides ?? null,
  });
  return { intel, recomputed: true };
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const runDate = (b: RunBundleV1) => b.run.finished_at ?? b.run.started_at;
const refs = (rs: { qid: string; engine: string }[]) => rs.map((r) => `${r.qid}:${r.engine}`);

function answerStatus(a: RunBundleV1["answers"][number]): string {
  if (a.ok) return "ok";
  return isNotShownRow(a as { ok: boolean; error?: string | null }) ? "not_shown" : "failed";
}

function runRows(b: RunBundleV1): ExportRow {
  const o = b.scores?.overall;
  return {
    run_id: b.run.id,
    run_date: runDate(b),
    kind: b.run.kind,
    profile: b.run.profile,
    brand: b.run.brand.name,
    domain: b.run.brand.domain,
    engines: [...b.run.engines],
    models: Object.entries(b.run.models ?? {}).map(([role, id]) => `${role}=${id}`),
    judge_mode: b.run.judge_mode ?? null,
    questions: b.questions.length,
    answers: b.answers.length,
    scored_answers: o?.answered ?? null,
    recommended: o?.recommended ?? null,
    mentioned: o?.mentioned ?? null,
    est_cost_usd: b.run.est_cost_usd,
    baseline_run_id: b.run.baseline_run_id ?? null,
  };
}

function answerRows(b: RunBundleV1): ExportRow[] {
  const d = runDate(b);
  return b.answers.map((a) => {
    const v = a.verdict ?? null;
    const urls = (a.citations ?? []).map((c) => c.url).filter((u): u is string => typeof u === "string" && u.length > 0);
    const rivals = (v?.other_brands ?? [])
      .map((x) => (typeof x === "string" ? x : (x as { name?: string }).name ?? ""))
      .filter(Boolean);
    return {
      run_id: b.run.id,
      run_date: d,
      qid: a.qid,
      qtype: a.qtype,
      question: a.question,
      engine: a.engine,
      engine_label: engineLabel(a.engine),
      status: answerStatus(a),
      brand_present: v ? v.brand_present : null,
      mention_type: v?.mention_type ?? null,
      prominence: v?.prominence ?? null,
      sentiment: v?.sentiment ?? null,
      rivals_named: rivals,
      citations: urls.length,
      citation_urls: urls,
      samples: a.samples?.length ?? 0,
      excerpt: v?.excerpt ? oneLine(v.excerpt) : null,
      answer_text: a.raw_text ?? "",
      // the representative draw's searches; null when the engine does not report them
      search_queries: Array.isArray(a.search_queries) ? [...a.search_queries] : null,
    };
  });
}

/** One row per search query, per draw: every sample when the question was
 *  asked more than once, else the answer itself as sample 0. Engines that do
 *  not report their searches (search-queries.ts) contribute no rows. */
function searchQueryRows(b: RunBundleV1): ExportRow[] {
  const d = runDate(b);
  const out: ExportRow[] = [];
  for (const a of b.answers) {
    const draws = a.samples?.length
      ? a.samples.map((s) => ({ sample: s.sampleIdx, queries: s.search_queries }))
      : [{ sample: 0, queries: a.search_queries }];
    for (const draw of draws) {
      (draw.queries ?? []).forEach((query, i) => {
        out.push({ run_id: b.run.id, run_date: d, qid: a.qid, engine: a.engine, sample: draw.sample, position: i + 1, query });
      });
    }
  }
  return out;
}

function citationRows(b: RunBundleV1): ExportRow[] {
  const d = runDate(b);
  const pages = new Map<string, RunBundleV1["corpus_pages"][number]>();
  for (const p of b.corpus_pages) {
    pages.set(p.url, p);
    if (p.final_url) pages.set(p.final_url, p);
  }
  type BundleCitation = { qid: string; engine: string; url: string; normUrl?: string; norm_url?: string; host?: string; position?: number | null };
  return (b.citations as unknown as BundleCitation[]).map((c) => {
    const norm = c.normUrl ?? c.norm_url ?? c.url;
    const page = pages.get(c.url) ?? pages.get(norm) ?? null;
    return {
      run_id: b.run.id,
      run_date: d,
      qid: c.qid,
      engine: c.engine,
      position: c.position ?? null,
      url: c.url,
      host: c.host || sourceHost(c.url),
      page_title: page?.title ?? null,
      page_type: page?.page_type ?? null,
      brand_on_page: page ? page.brand_present : null,
      rivals_on_page: page?.competitors_present ?? [],
    };
  });
}

function sourceTables(b: RunBundleV1, overrides: SourceOverrides | null | undefined) {
  const d = runDate(b);
  const { intel } = sourceIntelFor(b, overrides);
  const sources: ExportRow[] = intel.domains.map((s) => ({
    run_id: b.run.id,
    run_date: d,
    host: s.host,
    type: s.type,
    type_rule: s.typeRule,
    citations: s.citations,
    share: Math.round(s.share * 1000) / 1000,
    answers: s.answers,
    brand_named_answers: s.brandNamedAnswers,
    rival_won_answers: s.rivalWonAnswers,
    engines: Object.keys(s.byEngine).filter((e) => (s.byEngine[e] ?? 0) > 0),
  }));
  const opportunities: ExportRow[] = intel.opportunities.map((o, i) => ({
    run_id: b.run.id,
    run_date: d,
    rank: i + 1,
    host: o.host,
    type: o.type,
    evidence: o.evidence,
    engines: [...o.engines],
    rivals: o.rivals.map((r) => r.name),
    page_check: o.pageCheck,
    brand_named_answers: o.brandNamedAnswers,
    top_page_url: o.topPage?.url ?? null,
    why: o.why,
    receipts: refs(o.receipts),
  }));
  const share_of_voice: ExportRow[] = [];
  for (const v of intel.voice) {
    share_of_voice.push({
      run_id: b.run.id,
      run_date: d,
      name: v.name,
      is_brand: v.isBrand,
      scope: "all",
      named: v.named,
      recommended: v.recommended,
      receipts: refs(v.refs),
    });
    for (const [engine, n] of Object.entries(v.byEngine)) {
      if (!n) continue;
      share_of_voice.push({
        run_id: b.run.id,
        run_date: d,
        name: v.name,
        is_brand: v.isBrand,
        scope: engine,
        named: n,
        recommended: null,
        receipts: refs(v.refs.filter((r) => r.engine === engine)),
      });
    }
  }
  return { sources, opportunities, share_of_voice };
}

function fixRows(b: RunBundleV1): ExportRow[] {
  const d = runDate(b);
  return b.fixes.map((f, i) => ({
    run_id: b.run.id,
    run_date: d,
    rank: i + 1,
    fix_key: f.fixKey,
    title: f.title,
    factor: f.factor,
    weight: f.weight,
    effort: f.effort,
    engines: [...(f.engines ?? [])],
    evidence: [...(f.evidence ?? [])],
    has_artifact: typeof f.artifact === "string" && f.artifact.trim().length > 0,
  }));
}

function crawlerRows(r: CrawlerReport): ExportRow[] {
  return r.bots.map((bot) => ({
    window_from: r.window.from,
    window_to: r.window.to,
    bot_id: bot.id,
    bot: bot.label,
    operator: bot.operator,
    purpose: bot.purpose,
    ai: bot.ai,
    requests: bot.hits,
    pages: bot.distinctPages,
    blocked: bot.blocked,
    server_errors: bot.errors,
    not_found: bot.notFound,
    verified: r.ipVerification.mode === "on" ? bot.verification.verified : null,
    unverified: r.ipVerification.mode === "on" ? bot.verification.unverified : null,
    first_seen: bot.firstSeen,
    last_seen: bot.lastSeen,
  }));
}

/** Visits from AI assistants, from the same crawler report. A report made
 *  before 0.2.0 has no referrals block and adds no rows. */
function referralRows(r: CrawlerReport): ExportRow[] {
  return (r.referrals?.assistants ?? []).map((a) => ({
    window_from: r.window.from,
    window_to: r.window.to,
    assistant_id: a.id,
    assistant: a.label,
    operator: a.operator,
    visits: a.visits,
    via_referrer: a.viaReferrer,
    via_utm_source: a.viaUtmSource,
    top_pages: a.pages.map((p) => `${p.path} (${p.visits})`),
    first_seen: a.firstSeen,
    last_seen: a.lastSeen,
  }));
}

/** Every table for the given runs (oldest first) and crawler report. */
export function buildDataExport(input: DataExportInput): DataExport {
  const bundles = [...input.bundles].sort((a, b) => runDate(a).localeCompare(runDate(b)));
  const tables = Object.fromEntries(EXPORT_TABLES.map((t) => [t, [] as ExportRow[]])) as DataExport["tables"];
  for (const b of bundles) {
    tables.runs.push(runRows(b));
    tables.answers.push(...answerRows(b));
    tables.citations.push(...citationRows(b));
    const s = sourceTables(b, input.overrides);
    tables.sources.push(...s.sources);
    tables.opportunities.push(...s.opportunities);
    tables.share_of_voice.push(...s.share_of_voice);
    tables.fixes.push(...fixRows(b));
    tables.search_queries.push(...searchQueryRows(b));
  }
  if (input.crawlers) {
    tables.crawlers.push(...crawlerRows(input.crawlers));
    tables.ai_referrals.push(...referralRows(input.crawlers));
  }
  const notes = [
    "Counts only: every number is read from the run bundles or the crawler report, nothing is estimated.",
    "share_of_voice counts answers that name each brand (scope \"all\" or one engine); it is not market share.",
    "search_queries lists the searches ChatGPT, Claude and Gemini report running; Perplexity and the SerpApi surfaces do not report theirs, and runs before 0.2.0 did not keep them.",
  ];
  if (!input.crawlers) notes.push("crawlers and ai_referrals are empty: pass a crawlers.json from `saylent crawlers --out`.");
  else if (!input.crawlers.referrals) notes.push("ai_referrals is empty: the crawlers.json was made before referrals were counted (saylent 0.2.0); run `saylent crawlers` on the log again.");
  else notes.push("ai_referrals is a floor: an assistant visit with no Referer and no utm_source looks like direct traffic.");
  return {
    export_format: EXPORT_FORMAT,
    schema_version: EXPORT_SCHEMA_VERSION,
    generated_at: (input.now ?? new Date()).toISOString(),
    columns: EXPORT_COLUMNS,
    tables,
    notes,
  };
}

/** One CSV cell: lists joined with " | ", null as empty. */
export function csvCell(v: Cell | undefined): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(" | ");
  return String(v);
}

/** One table as RFC 4180 CSV, in its documented column order. */
export function tableCsv(doc: Pick<DataExport, "tables">, table: ExportTable): string {
  const cols = EXPORT_COLUMNS[table];
  return `${toCsv(cols, doc.tables[table].map((row) => cols.map((c) => csvCell(row[c]))))}\r\n`;
}
