// THE ONE TOTALS LINE. A run has four different counts and every surface used
// to pick its own: "9 scored answers", "measured from 18 responses", "the 24 raw
// answers", "24 live AI responses" (which was untrue — six calls returned
// nothing). They are all true of different things, so they are stated together,
// once, in the same words everywhere: the report header, the Markdown footer and
// the disclaimer all render `totalsLine()`.
//
// Pure + unit-tested; no React, no Next, no Supabase.

/** The minimal answer shape these counts need (a subset of the dossier's AnswerRow). */
export interface TotalsAnswer {
  ok?: boolean;
  qtype?: string;
}

export interface RunTotals {
  /** calls made: one per question per engine */
  asked: number;
  /** calls that came back with an answer */
  answered: number;
  /** calls that returned nothing (engine error, refusal, empty body) */
  failed: number;
  /** answers that enter the headline denominator (what-to-buy + problem) */
  scored: number;
}

/** Count a run's four totals. `scoredAnswered` is the stored
 *  `scores.overall.answered` — the scorer's own count, which is the headline
 *  denominator everywhere else; pass it whenever it is available so this line
 *  can never disagree with the tiles. */
export function runTotals(answers: TotalsAnswer[], scoredAnswered?: number | null): RunTotals {
  const asked = answers.length;
  const answered = answers.filter((a) => a.ok !== false).length;
  const scored =
    typeof scoredAnswered === "number" && Number.isFinite(scoredAnswered)
      ? scoredAnswered
      : answers.filter((a) => a.ok !== false && SCORED_QTYPES.has(a.qtype ?? "")).length;
  return { asked, answered, failed: asked - answered, scored };
}

/** The scorer scores category + problem questions only (see brief.ts's ONE
 *  DENOMINATOR RULE). Mirrored here for the fallback path only. */
const SCORED_QTYPES = new Set(["category", "problem"]);

/** "24 asked · 18 answered · 6 engine failures · 9 scored" — the failures term
 *  drops out when nothing failed, because a zero there is noise, not news. */
export function totalsLine(t: RunTotals): string {
  const parts = [`${t.asked} asked`, `${t.answered} answered`];
  if (t.failed > 0) parts.push(`${t.failed} engine failure${t.failed === 1 ? "" : "s"}`);
  parts.push(`${t.scored} scored`);
  return parts.join(" · ");
}

/** The one sentence that says out loud what the failures were. Null when every
 *  call came back, so a clean run never carries an apology. */
export function failuresLine(t: RunTotals): string | null {
  if (t.failed <= 0) return null;
  return `${t.failed} of the ${t.asked} calls returned no answer (an engine error or an empty response), so they are counted nowhere below.`;
}
