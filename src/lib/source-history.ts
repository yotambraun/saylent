// "Sources over time" on the brand page: the pure shaping between the rows the
// page reads (answers + corpus_pages for the brand's last few finished runs, under
// the owner's RLS session) and what it renders. The arithmetic itself is the
// engine's (sources.ts buildSourceIntelligence per run, then buildSourceHistory
// across them); this module only groups rows by run, applies the brand's
// source-type overrides, and turns the result into display rows.
//
// Every number is a COUNT with a receipt in a run's report (#sources), never a
// percentage: a citation count per run, "an off-site opportunity in N of M runs",
// and answers naming each brand per run.
//
// PURE: no Next, no Supabase. The page does the reads and passes the rows in.
import {
  buildSourceHistory,
  buildSourceIntelligence,
  DOMAIN_TYPE_LABEL,
  type DomainType,
  type SourceAnswerInput,
  type SourceOverrides,
  type SourcePageInput,
} from "@saylent/engine/sources";

/** Runs the section reads at most. Six is a season of monthly audits, and keeps
 *  the read to a few hundred answer rows. */
export const SOURCE_HISTORY_MAX_RUNS = 6;
/** Domains and rivals the section lists. */
export const SOURCE_HISTORY_MAX_DOMAINS = 10;
export const SOURCE_HISTORY_MAX_RIVALS = 3;

export interface SourceHistoryRunRow {
  id: string;
  created_at: string;
}

export type SourceHistoryAnswerRow = SourceAnswerInput & { run_id: string };
export type SourceHistoryPageRow = SourcePageInput & { run_id: string };

export interface SourceHistoryDomainRow {
  host: string;
  type: DomainType;
  typeLabel: string;
  /** citations per run, oldest first (0 = not cited that run) */
  citations: number[];
  total: number;
  /** runs in which it was an off-site opportunity */
  opportunityRuns: number;
}

export interface SourceHistoryView {
  runs: { runId: string; date: string; answers: number; citations: number; opportunities: number }[];
  domains: SourceHistoryDomainRow[];
  voice: { name: string; isBrand: boolean; named: number[] }[];
  /** the newest run, whose report's #sources section holds the receipts */
  latestRunId: string;
}

export type SourceHistoryResult =
  | { ok: true; view: SourceHistoryView }
  | { ok: false; reason: "no_runs" | "no_citations" };

/** The last `max` runs, oldest first (the order every per-run strip uses). */
export function pickSourceHistoryRuns<T extends SourceHistoryRunRow>(
  doneRuns: readonly T[],
  max = SOURCE_HISTORY_MAX_RUNS,
): T[] {
  return [...doneRuns].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(-max);
}

/** brands.run_options.sourceOverrides, read defensively (a jsonb blob). */
export function readSourceOverrides(runOptions: unknown): SourceOverrides | null {
  const ov = (runOptions as { sourceOverrides?: { domainTypes?: unknown } } | null)?.sourceOverrides;
  const map = ov?.domainTypes;
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  return Object.keys(map).length ? { domainTypes: map as Record<string, DomainType> } : null;
}

export function buildBrandSourceHistory(input: {
  brand: { name: string; domain: string; aliases?: string[] | null; competitors?: string[] | null };
  runs: readonly SourceHistoryRunRow[];
  answers: readonly SourceHistoryAnswerRow[];
  corpus: readonly SourceHistoryPageRow[];
  overrides?: SourceOverrides | null;
}): SourceHistoryResult {
  const runs = pickSourceHistoryRuns(input.runs);
  if (runs.length === 0) return { ok: false, reason: "no_runs" };

  const answersByRun = new Map<string, SourceAnswerInput[]>();
  for (const { run_id, ...a } of input.answers) {
    const list = answersByRun.get(run_id) ?? [];
    list.push(a);
    answersByRun.set(run_id, list);
  }
  const pagesByRun = new Map<string, SourcePageInput[]>();
  for (const { run_id, ...p } of input.corpus) {
    const list = pagesByRun.get(run_id) ?? [];
    list.push(p);
    pagesByRun.set(run_id, list);
  }

  const perRun = runs.map((r) => ({
    runId: r.id,
    date: r.created_at,
    intel: buildSourceIntelligence({
      brand: input.brand,
      answers: answersByRun.get(r.id) ?? [],
      corpus: pagesByRun.get(r.id) ?? [],
      overrides: input.overrides ?? null,
    }),
  }));
  if (perRun.every((r) => r.intel.totals.citations === 0)) return { ok: false, reason: "no_citations" };

  const history = buildSourceHistory(perRun, {
    maxDomains: SOURCE_HISTORY_MAX_DOMAINS,
    maxRivals: SOURCE_HISTORY_MAX_RIVALS,
  });
  return {
    ok: true,
    view: {
      runs: history.runs.map((r) => ({
        runId: r.runId,
        date: r.date,
        answers: r.answers,
        citations: r.citations,
        opportunities: r.opportunities,
      })),
      domains: history.domains.map((d) => ({
        host: d.host,
        type: d.type,
        typeLabel: DOMAIN_TYPE_LABEL[d.type] ?? d.type,
        citations: d.citations,
        total: d.citations.reduce((s, n) => s + n, 0),
        opportunityRuns: d.opportunityRuns,
      })),
      voice: history.voice,
      latestRunId: history.runs[history.runs.length - 1]?.runId ?? runs[runs.length - 1].id,
    },
  };
}

/** "an off-site opportunity in 2 of 3 runs" — null when it never was one. */
export function opportunityBadge(opportunityRuns: number, runCount: number): string | null {
  if (opportunityRuns <= 0) return null;
  return runCount === 1 ? "off-site opportunity" : `opportunity in ${opportunityRuns} of ${runCount} runs`;
}
