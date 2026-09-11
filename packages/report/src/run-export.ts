// Per-run data export (the $79 deliverable must be
// able to LEAVE the app). Pure builders so the /api/runs/[id]/export route stays a thin
// auth + fetch + stream shell and the serialization is unit-tested. JSON = a compact,
// self-describing receipt (run meta, scores, per-engine verdicts + citations, fix plan,
// corpus summary) — LOSSY: it drops raw_text, per-sample draws and the flattened
// citations projection. CSV = the answers table flattened, one row per (question ×
// engine). The LOSSLESS format is the run bundle (packages/engine/src/bundle.ts,
// `format=bundle` on this same route) — everything a report needs to re-render or a
// verify run needs to reuse, nothing dropped.

export interface ExportRunMeta {
  id: string;
  kind: string;
  profile: string;
  status: string;
  created_at: string;
  finished_at: string | null;
  est_cost_usd: number | null;
}

export interface ExportAnswer {
  qid: string;
  question: string;
  engine: string;
  qtype?: string | null;
  verdict: Record<string, unknown> | null;
  citations: { url?: string | null; title?: string | null }[] | null;
}

export interface ExportFix {
  fix_key?: string | null;
  title: string | null;
  factor?: string | null;
  weight: number | null;
  effort?: string | null;
  evidence: unknown;
  artifact: string | null;
}

export interface ExportCorpusPage {
  page_type?: string | null;
  cited_by?: unknown;
  opportunity?: boolean | null;
}

export interface RunExportInput {
  run: ExportRunMeta;
  brand: { name: string; domain: string };
  scores: unknown;
  answers: ExportAnswer[];
  fixes: ExportFix[];
  corpus: ExportCorpusPage[];
}

const str = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);

/** Citation URLs for one answer, in order, dropping empties. */
export function citationUrls(
  citations: { url?: string | null }[] | null | undefined,
): string[] {
  return (citations ?? [])
    .map((c) => (typeof c?.url === "string" ? c.url.trim() : ""))
    .filter((u) => u.length > 0);
}

/** The self-describing JSON document — a portable receipt of the whole run. */
export function buildRunExportJson(input: RunExportInput) {
  const { run, brand, scores, answers, fixes, corpus } = input;
  return {
    export_format: "saylent.run-export/v1",
    exported_at: new Date().toISOString(),
    run: {
      id: run.id,
      kind: run.kind,
      profile: run.profile,
      status: run.status,
      created_at: run.created_at,
      finished_at: run.finished_at,
      est_cost_usd: run.est_cost_usd,
    },
    brand: { name: brand.name, domain: brand.domain },
    scores: scores ?? null,
    answers: answers.map((a) => {
      const v = (a.verdict ?? {}) as Record<string, unknown>;
      return {
        qid: a.qid,
        question: a.question,
        engine: a.engine,
        qtype: a.qtype ?? null,
        brand_present: v.brand_present ?? null,
        mention_type: v.mention_type ?? null,
        prominence: v.prominence ?? null,
        sentiment: v.sentiment ?? null,
        citations: (a.citations ?? []).map((c) => ({
          url: c?.url ?? null,
          title: c?.title ?? null,
        })),
      };
    }),
    fixes: fixes.map((f) => ({
      fix_key: f.fix_key ?? null,
      title: f.title,
      factor: f.factor ?? null,
      weight: f.weight,
      effort: f.effort ?? null,
      evidence: f.evidence ?? null,
      artifact: f.artifact,
    })),
    corpus_summary: summarizeCorpus(corpus),
  };
}

/** A compact roll-up of the crawled/cited corpus (the full pages live in the
 *  account-wide GDPR export; a per-run receipt just needs the shape). */
export function summarizeCorpus(corpus: ExportCorpusPage[]) {
  const byType: Record<string, number> = {};
  let cited = 0;
  let opportunities = 0;
  for (const p of corpus) {
    const t = p.page_type ?? "unknown";
    byType[t] = (byType[t] ?? 0) + 1;
    if (Array.isArray(p.cited_by) ? p.cited_by.length > 0 : Boolean(p.cited_by)) cited += 1;
    if (p.opportunity) opportunities += 1;
  }
  return { total_pages: corpus.length, cited_pages: cited, opportunity_pages: opportunities, by_type: byType };
}

export const CSV_HEADERS = [
  "qid",
  "question",
  "engine",
  "mention_type",
  "prominence",
  "sentiment",
  "citation_urls",
] as const;

/** One flat row per answer, in CSV_HEADERS order — the analyst-friendly table. */
export function answerCsvRows(answers: ExportAnswer[]): string[][] {
  return answers.map((a) => {
    const v = (a.verdict ?? {}) as Record<string, unknown>;
    return [
      a.qid,
      a.question,
      a.engine,
      str(v.mention_type) ?? "",
      str(v.prominence) ?? "",
      str(v.sentiment) ?? "",
      citationUrls(a.citations).join(" | "),
    ];
  });
}

/** RFC 4180 CSV: fields with comma/quote/CR/LF are wrapped in quotes and inner
 *  quotes doubled. Rows joined with CRLF. */
export function toCsv(headers: readonly string[], rows: string[][]): string {
  const esc = (field: string) =>
    /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
  const line = (cells: readonly string[]) => cells.map((c) => esc(c ?? "")).join(",");
  return [line(headers), ...rows.map(line)].join("\r\n");
}

/** URL-safe, human-readable slug for the filename. */
export function slugifyBrand(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "brand";
}

/** `saylent-{brand}-{YYYY-MM-DD}.{ext}` — stable, sortable, no PII beyond brand. */
export function exportFilename(brandName: string, date: Date, ext: "csv" | "json"): string {
  return `saylent-${slugifyBrand(brandName)}-${date.toISOString().slice(0, 10)}.${ext}`;
}
