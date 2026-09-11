// The row shapes a report renders from — EXACTLY what the Next page hands the
// components today (get_dossier's payload), so the app and the static file are
// fed the same object (see ARCHITECTURE.md).
// The CLI's run bundle (@saylent/engine/bundle) carries these same rows.
import type { AnswerRow, CorpusRow } from "../components/drawers";
import type { CheckRow, FixRow } from "../components/dossier";
import type { RunRow } from "../components/run-view";

export type { AnswerRow, CorpusRow, CheckRow, FixRow, RunRow };

export interface ReportBrand {
  name: string;
  domain: string;
  aliases: string[];
  competitors: string[];
  /** when the requester attested authorization (drives the methodology & honesty line) */
  authorized_at?: string | null;
}

/** The previous done audit of this brand — the progress story. */
export interface ReportPrevious {
  created_at: string;
  finished_at: string | null;
  scores: unknown;
}

export interface ReportData {
  run: RunRow;
  brand: ReportBrand;
  answers: AnswerRow[];
  corpus: CorpusRow[];
  checks: CheckRow[];
  fixes: FixRow[];
  previous?: ReportPrevious | null;
}

/** The run's provenance, printed in the report header. Every number has a receipt;
 *  the header states where the numbers came from and what they cost. */
export interface ReportMeta {
  /** "full" | "smoke" — the question-set profile the run used */
  profile: string;
  /** the engines that actually answered, in display order */
  engines: string[];
  /** engine → model id (the model-registry values, packages/engine/src/models.ts) */
  models: Record<string, string>;
  /** run cost in USD; null when it was never recorded */
  cost: number | null;
  /** how the answers were judged: "cross-family" (two provider keys, an answer is
   *  judged by the OTHER family) or "single-family" (one key served every role).
   *  Undefined on runs recorded before single-provider mode existed. */
  judgeMode?: "cross-family" | "single-family";
  /** stages the user skipped by request (drafts, corpus fetches, site gates); absent when none */
  skip?: { drafts?: boolean; corpus?: boolean; gates?: boolean } | null;
}

export interface RenderReportOptions {
  /** "auto" follows prefers-color-scheme (default); the toggle always wins */
  theme?: "auto" | "light" | "dark";
  /** document title and the <h1>-adjacent name */
  title: string;
  /** ISO timestamp the file was written */
  generatedAt: string;
  meta: ReportMeta;
  /** the address a reader writes to about the report's content. Omitted ⇒ the
   *  "Report an inaccuracy" affordance is not rendered (no placeholder mailbox). */
  contactEmail?: string;
  /** absolute URL for "How we measure". Omitted ⇒ the public methodology page
   *  (render/static-host.tsx's DEFAULT_METHODOLOGY_URL). */
  methodologyUrl?: string | null;
  /** One line marking a report rendered from a published SAMPLE bundle (a
   *  fictional brand, replaced competitor names). Rendered as a banner above
   *  everything else, so a reader who opens the file out of context cannot
   *  mistake it for a real audit of a real company. */
  sampleNotice?: string;
}
