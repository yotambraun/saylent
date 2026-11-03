// The one bridge from report rows to the engine's source intelligence
// (@saylent/engine/sources): the dossier section, the Markdown section and the
// app all call sourcesFor(), so the same run can never show two different
// opportunity lists. Pure; the computation itself lives (and is tested) in the
// engine.
import {
  type SourceIntelligence,
  type SourceOverrides,
  DOMAIN_TYPE_LABEL,
  buildSourceIntelligence,
} from "@saylent/engine/sources";
import { engineLabel } from "@saylent/engine/surfaces";

export type { SourceIntelligence, SourceOverrides };

export interface SourcesRowsInput {
  brand: { name: string; domain: string; aliases?: string[] | null; competitors?: string[] | null };
  answers: {
    qid: string;
    engine: string;
    qtype?: string | null;
    question?: string | null;
    ok: boolean;
    citations?: { url: string; title?: string | null }[] | null;
    verdict?: unknown;
  }[];
  corpus?: {
    url: string;
    final_url?: string | null;
    title?: string | null;
    page_type?: string | null;
    brand_present?: boolean | null;
    competitors_present?: string[] | null;
  }[];
  overrides?: SourceOverrides | null;
}

export function sourcesFor(input: SourcesRowsInput): SourceIntelligence {
  return buildSourceIntelligence({
    brand: input.brand,
    answers: input.answers.map((a) => ({ ...a, verdict: (a.verdict ?? null) as never })),
    corpus: input.corpus ?? [],
    overrides: input.overrides ?? null,
  });
}

export const typeLabel = (t: string): string => (DOMAIN_TYPE_LABEL as Record<string, string>)[t] ?? t;

const pct = (share: number) => {
  const p = share * 100;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
};
export const sharePct = pct;

/** The section's one-line lede: counts only, every term defined. Null when the
 *  run cited nothing. */
export function sourcesLede(intel: SourceIntelligence): string | null {
  const t = intel.totals;
  if (t.citations === 0) return null;
  const topType = intel.byType.find((b) => b.type !== "other") ?? intel.byType[0];
  const typePart = topType
    ? ` The most-cited domain type is ${typeLabel(topType.type).toLowerCase()}: ${topType.citations} of them (${pct(topType.citations / t.citations)}).`
    : "";
  return `${t.citations} citation${t.citations === 1 ? "" : "s"} to ${t.domains} domain${t.domains === 1 ? "" : "s"} across ${t.answersWithCitations} of the ${t.answers} answers.${typePart}`;
}

/** "q01 · ChatGPT" — the receipt label every view uses. */
export const receiptLabel = (r: { qid: string; engine: string }) => `${r.qid} · ${engineLabel(r.engine)}`;
