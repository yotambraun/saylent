// THE BRIEF — the
// answer-first lead layer. Voice: counts before percentages, flat
// exact evidence copy, correlational language, no jargon, no hype. Pure + $0:
// every scene is composed DETERMINISTICALLY from stored run data (no LLM).
// Unit-testable like report-intel — NO React/Next imports; the view (dossier's
// sibling) renders it.
//
// A Brief is a story branch + a hero + a deck of self-hiding question cards. Each
// card is a tiny private composer that returns null when its data is absent, so a
// thin run simply shows fewer cards. Each card interior is a
// COMPLETE receipted mini-answer (status/pages/moves/kv/quote blocks) rather than
// a thin text list — the run holds gold, the card must show it. Every numeric
// claim carries a receipt handle (answer id / corpus id) so the UI can open the
// same stored-answer drawer the dossier uses. The card SOURCES + self-hide rules
// are the ones proven in report-intel/rival-gaps/fix-groups/gates-lede — this
// module only re-composes them into an answer-first narration; it invents no new
// statistic.
//
// COPY RULE: the em-dash "—" as a sentence
// connector is an AI-tell watermark and MUST NOT appear in ANY string this module
// AUTHORS (teasers, hero lines, takeaways, kv values, text/summary lines). Use
// plain sentences, colons, commas or the middot "·". EXCEPTIONS: verbatim engine
// quotes/claims/segments passed through from stored data stay untouched (receipts
// are verbatim by law), and numeric ranges keep the en-dash ("44–46").
import { gatesLede, gateTally, robotsVsLiveNote, type GateCheck } from "./gates-lede";
import { runTotals, totalsLine, type RunTotals } from "./totals";
import {
  bandDescriptor,
  battlefieldRows,
  buriedBehind,
  citationDepth,
  consensusSources,
  degradedEngines,
  entityConfusion,
  mergedPricingClaims,
  opportunityPages,
  ownSiteCoverage,
  perceptionClaims,
  pricingFigures,
  rankRiskClaims,
  sendElsewhere,
  sourceMix,
  toneCounts,
  CONSENSUS_PHRASE,
  type AnswerRef,
  type BandLike,
  type IntelAnswer,
  type IntelPage,
  type RunHealthLike,
  type SitePageMeta,
} from "./report-intel";
import { buildSourceMap } from "./source-map";
import { deltaState } from "./trend";
import { groupFixes, pickTopMoves, type FixGroup, type FixLike } from "./fix-groups";
import { rivalGaps } from "./rival-gaps";
import { makeRivalOwner } from "@saylent/engine/rival-owner";
import { isScored } from "@saylent/engine/score";
import { sovEntries, topRivalPick, topRivalSentence, type TopRivalPick } from "./sov";
import { previewText } from "./strip-md";

/* ============================ public API ================================== */

export type BriefStory = "dominant" | "challenger" | "thin";

/** A receipt handle back to the stored row that backs a number. `id` is
 *  answers.id (or the qid|engine composite when a run wasn't fetched with ids)
 *  for answer receipts, and corpus row id (or the page url) for page receipts —
 *  the UI resolves it to open the same drawer the dossier opens. */
export interface BriefReceipt {
  kind: "answer" | "page";
  id: string;
  label: string;
}

export interface BriefBar {
  label: string;
  count: number;
  highlight?: boolean;
  receipt?: BriefReceipt;
}
export interface BriefListItem {
  text: string;
  receipt?: BriefReceipt;
}

/** A discriminated block the card renders (the view
 *  renders exactly these kinds). `text` is prose; `stat` is one big number + label;
 *  `bars` is a small ranked bar set with a one-line takeaway; `list` is
 *  receipt-linked bullet lines; `quote` is one verbatim engine line with optional
 *  engine-count / attribution / receipt; `status` is a pass/fail/warn/info checklist
 *  (the live-crawler gates); `pages` is the deciding-page table (host/url/cited/
 *  engines/present + receipt); `moves` is the ranked fix plan (effort/time-to-impact/
 *  engines/draft-ready); `kv` is a labelled key→value method table. */
export type BriefBlock =
  | { kind: "text"; text: string }
  | { kind: "stat"; label: string; value: string; receipt?: BriefReceipt }
  | { kind: "bars"; rows: BriefBar[]; takeaway: string }
  | { kind: "list"; items: BriefListItem[] }
  | { kind: "quote"; text: string; attribution?: string; count?: number; receipt?: BriefReceipt }
  | {
      kind: "status";
      rows: { label: string; state: "pass" | "fail" | "warn" | "info"; detail?: string; receipt?: BriefReceipt }[];
    }
  | {
      kind: "pages";
      rows: {
        host: string;
        url: string;
        title?: string;
        cited: number;
        engines: string[];
        present: boolean | null;
        /** short render-ready "decides q01 · q07" line from cited_for_qids */
        decides?: string;
        receipt?: BriefReceipt;
      }[];
    }
  | {
      kind: "moves";
      rows: { rank: number; title: string; effort?: string; timeToImpact?: string; engines?: string[]; draftReady?: boolean }[];
    }
  | { kind: "kv"; rows: { k: string; v: string; receipt?: BriefReceipt }[] };

export interface BriefCard {
  id: string;
  /** the buyer question this card answers, in the buyer's own words */
  question: string;
  /** one sentence, ≤90 chars, a real number when available, evidence voice */
  teaser: string;
  blocks: BriefBlock[];
  /** sibling card ids to jump to next (2–3, story-appropriate, existing only) */
  followups: string[];
  /** dossier section anchor to deep-link into (verified against dossier.tsx) */
  anchor: string;
}

export interface Brief {
  story: BriefStory;
  hero: {
    headline: string;
    sub: string;
    stats: {
      label: string;
      value: string;
      /** dossier section anchor to deep-link into (same contract as
       *  BriefCard.anchor) — verified against dossier.tsx. Undefined ⇒ the
       *  tile stays a static readout (the "vs last audit" delta tile, the
       *  "thin" story's "Answers captured" tile, etc.). */
      href?: string;
    }[];
    /** Facts counted on a DIFFERENT base than the headline (branded and
     *  head-to-head questions). Each sentence names its own base, so it can sit
     *  beside the hero without ever being read as part of "of N scored". */
    notes: string[];
    /** The one-line "how to read the numbers" rule for this report. */
    basis: string;
  };
  cards: BriefCard[];
}

/* ------------------------- structural inputs ------------------------------ */
// Minimal duck-types mirroring the DB rows the dossier fetches. They are
// deliberately supersets of report-intel's IntelAnswer/IntelPage so the same
// RLS-fetched rows pass straight through — we never import dossier.tsx types.

/** answers row (adds the optional DB `id` on top of IntelAnswer). */
export interface BriefAnswer extends IntelAnswer {
  id?: string;
}
/** corpus_pages row (adds the optional DB `id` on top of IntelPage). */
export interface BriefPage extends IntelPage {
  id?: string;
}
/** domain_checks row — status widens to string in the DB; narrowed at the gate call. */
export interface BriefCheck {
  check_name: string;
  status: string;
  detail: string;
}
/** fixes row (structural subset — the weight-ranked plan). `engines` is the
 *  distinct engines the fix can move; `effort`,
 *  `time_to_impact` and `artifact` are the do-first move metadata the dossier's
 *  fix cards already render — the Brief's `moves` block reuses the SAME stored
 *  values verbatim, never a guess. */
export interface BriefFix extends FixLike {
  fix_key: string;
  title: string;
  weight: number;
  engines?: string[];
  effort?: string;
  time_to_impact?: string;
  artifact?: string | null;
}

export interface BriefScores {
  overall?: {
    answered?: number;
    recommended?: number;
    mentioned?: number;
    rec_rate?: number | null;
    mention_rate?: number | null;
  };
  per_engine?: Record<
    string,
    {
      answered: number;
      recommended: number;
      mentioned: number;
      rec_rate: number | null;
      mention_rate?: number | null;
    }
  >;
  share_of_voice?: Record<string, number>;
  recommended_band?: { overall?: BandLike; per_engine?: Record<string, BandLike> };
}

/** The prior done audit of this brand — the progress story. Mirrors the
 *  `previous` the run page already derives for the dossier (page.tsx: prior
 *  scores + a formatted date), plus the recommended COUNT the delta rule needs.
 *  The page/view plumbing populates this from d.previous; the composer only reads
 *  it. Absent (first audit) ⇒ every delta line self-hides. */
export interface BriefPrevious {
  /** the prior run's recommended COUNT (scores.overall.recommended) */
  recommended: number;
  /** the prior run's scored answered count (for an honest "of N" if ever needed) */
  answered?: number;
  /** already-formatted prior-audit date (page.tsx toLocaleDateString) */
  date: string;
}

export interface BriefInput {
  brand: { name: string; domain: string; aliases?: string[]; competitors?: string[] };
  scores: BriefScores | null;
  answers: BriefAnswer[];
  corpus: BriefPage[];
  checks: BriefCheck[];
  fixes: BriefFix[];
  /** runs.health snapshot (degraded-engine caveat); absent on old runs. */
  health?: RunHealthLike | null;
  /** runs.site_pages crawl meta (own-site coverage); absent on old runs. */
  sitePages?: SitePageMeta[] | null;
  /** runs.brand_model.value_props — how the engines could describe the brand. */
  valueProps?: string[];
  /** runs.kind (weak-audit framing only applies to "audit"). */
  kind?: string;
  /** prior done audit for the progress delta; absent on a first audit. */
  previous?: BriefPrevious | null;
  /** the run date, already formatted ("09 Sept 2026"). The gates lede used to
   *  say "just now" in a file people read for years. */
  runDate?: string | null;
}

/* ============================ small helpers =============================== */

const ENGINE_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
};
const engineLabel = (e: string): string =>
  ENGINE_LABEL[e] ?? e.charAt(0).toUpperCase() + e.slice(1);

// Host fallback returns the FULL string (a non-URL) — width is a CSS concern; the
// render site truncates with a title=. JS never cuts a string for display width.
const hostOf = (u: string | null | undefined): string => {
  if (!u) return "";
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/** Clean any derived/label string the Brief emits through the ONE preview pipeline
 *  (strip markdown, collapse whitespace, trim). The stored raw stays verbatim
 *  behind the receipt; the narration must never read literal **…** or [4] marks. */
const clean = (s: string): string => previewText(s ?? "");

/** Clean a VERBATIM engine excerpt shown as a `quote` block: the preview pipeline
 *  with tail-tidy, since judge excerpts are stored pre-truncated and must never
 *  end mid-word ("…uses the mid…"). Applied at the FINAL visible tail only. The
 *  full answer stays one tap away as the verbatim receipt. */
const quote = (s: string): string => previewText(s ?? "", { tail: true });

/** Release-prep: strip the em-dash AI-tell from a string this module AUTHORS,
 *  replacing the "—" connector with a comma. NEVER call this on a verbatim engine
 *  quote/claim/segment (those are receipts and stay untouched); it exists only to
 *  scrub connector copy this module composes AROUND stored data (e.g. the gates
 *  lede sentence, which is authored upstream in gates-lede.ts). */
const deDash = (s: string): string => s.replace(/\s—\s/g, ", ");

/** ≤90-char safety clamp for teasers. Cut at the last CLAUSE boundary
 *  (comma/period/semicolon) that fits so a truncated list ends cleanly — never a
 *  dangling "…, or…" or a bare connective. Falls back to a word boundary. */
const TEASER_MAX = 90;
function clampTeaser(s: string): string {
  const t = s.trim();
  if (t.length <= TEASER_MAX) return t;
  const cut = t.slice(0, TEASER_MAX - 1);
  const clause = Math.max(cut.lastIndexOf(","), cut.lastIndexOf(";"), cut.lastIndexOf("."));
  let base: string;
  if (clause > 40) base = cut.slice(0, clause);
  else {
    const sp = cut.lastIndexOf(" ");
    base = sp > 40 ? cut.slice(0, sp) : cut;
  }
  // drop a dangling connective/article left at the cut ("…home delivery, or")
  base = base.replace(/[\s,;]+(?:or|and|to|for|with|the|a|an|of)$/i, "");
  return `${base.trimEnd().replace(/[,;.]+$/, "")}…`;
}

/** A ranked bar set carries no information when every bar is ≤1 (max=1
 *  ⇒ all bars render 100%-wide). Emit `bars` only when the max count ≥2; below
 *  that, emit a plain `list` (receipts preserved) whose text each composer shapes. */
function barsOrList(
  rows: BriefBar[],
  takeaway: string,
  toText: (b: BriefBar) => string,
): BriefBlock {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  if (max >= 2) return { kind: "bars", rows, takeaway };
  return { kind: "list", items: rows.map((r) => ({ text: toText(r), receipt: r.receipt })) };
}

/** The one gate every card teaser passes: strip markdown, then ≤90-char clamp
 *  (word-boundary aware, no ellipsis mid-word). */
function finishTeaser(s: string): string {
  return clampTeaser(clean(s));
}

const STAGE_NOUN: Record<string, string> = {
  category: "what-to-buy",
  comparison: "head-to-head",
  problem: "problem-stage",
  branded: "branded",
};

/* ====================== THE ONE DENOMINATOR RULE ==========================
 * The hero headline, the hero stat tiles and the top cards all count on ONE
 * base: SCORED ANSWERS.
 *
 *   A scored answer = one engine's answer to one what-to-buy (category) or
 *   problem question, counted once per question and engine after the repeat
 *   draws are voted into a single verdict.
 *
 * That is exactly what `scores.overall.answered` counts (the scorer scores
 * category + problem only), so the stored number and every sentence composed
 * here share one denominator, and recommended <= mentioned <= answered holds.
 *
 * Head-to-head (comparison) and branded questions are NOT scored: a branded
 * question already names the brand, so "recommended" there measures a
 * different thing. They are reported as SEPARATE, LABELLED facts ("in the 3
 * questions that name you, the engines back you in 2") and never enter the
 * headline's denominator.
 *
 * A card that must count something else (answers the brand is absent from,
 * steer conditions, cited pages) names its own base in the same sentence as
 * the number, and can never contradict the headline.
 *
 * Per-stage splits (0 of 6 what-to-buy) are only spoken when the rows in hand
 * add up to the stored scored count. On a trimmed or sampled export they do
 * not, so the hero falls back to the plain overall sentence rather than
 * putting two incompatible denominators on one screen. */
const SCORED_STAGES = ["category", "problem"] as const;
const OFF_BASE_STAGES = ["branded", "comparison"] as const;

/** The "how to read the numbers" line. Rendered under the hero stats and in
 *  the method card, so the base is stated once, where the numbers are. */
export const NUMBERS_BASIS =
  "How to read the numbers: every count here is out of the scored answers, the what-to-buy and problem questions, one answer per question and engine. Branded and head-to-head questions are counted separately and labelled wherever they appear.";

/* ============================ shared context ============================== */

interface Ctx {
  brand: string;
  domain: string;
  aliases: string[];
  competitors: string[];
  answered: number; // scored answered (scores.overall.answered)
  recommended: number;
  mentioned: number;
  recDisplay: string; // "44–46" (band) or "1"
  recMid: number; // band midpoint (or point/plain recommended) — the story key
  bandKind: "range" | "point" | "none";
  answeredTotal: number; // all ok answers
  /** scored rows actually in hand; equals `answered` on a complete run */
  scoredHeld: number;
  /** true when the rows in hand add up to `answered`, so a per-stage split of
   *  the base is safe to speak (see THE ONE DENOMINATOR RULE) */
  stageSplitSafe: boolean;
  /** branded / head-to-head tallies, each a labelled fact on its own base */
  offBase: OffBaseFact[];
  /** asked / answered / failed / scored, in the one wording every surface uses */
  totals: RunTotals;
  /** the top rival with its ties, broken on the rival-section ordering */
  rival: TopRivalPick | null;
  answerByRef: Map<string, BriefAnswer>;
  input: BriefInput;
}

function answerReceipt(ctx: Ctx, qid: string, engine: string): BriefReceipt {
  const a = ctx.answerByRef.get(`${qid}|${engine}`);
  // label carries only the engine name — the chip builds the verb-led text
  // ("Read {Engine}'s answer") from it; the qid is an internal handle, not shown.
  return {
    kind: "answer",
    id: a?.id ?? `${qid}|${engine}`,
    label: engineLabel(engine),
  };
}
const refReceipt = (ctx: Ctx, r: AnswerRef): BriefReceipt => answerReceipt(ctx, r.qid, r.engine);

function pageReceipt(p: BriefPage): BriefReceipt {
  return { kind: "page", id: p.id ?? p.url, label: hostOf(p.final_url ?? p.url) || p.url };
}

/** Distinct engines that cite a page, as display labels (first-seen order). */
function citingEngines(cited_by: Record<string, number>): string[] {
  return Object.entries(cited_by)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([e]) => engineLabel(e));
}

/** Per-stage tally inside the scored base; stages with no answer drop out. */
interface FunnelStage {
  key: string;
  answered: number;
  seen: number;
  rec: number;
}
/** Per-buyer-stage tallies WITHIN the scored base (category + problem). The
 *  headline's stage split is a partition of the same N the tiles show. */
function funnelOf(answers: BriefAnswer[]): FunnelStage[] {
  return SCORED_STAGES.map((key) => {
    const rows = answers.filter((a) => a.qtype === key && a.ok !== false);
    return {
      key,
      answered: rows.length,
      seen: rows.filter((a) => truthyPresent(a)).length,
      rec: rows.filter((a) => mentionType(a) === "recommended").length,
    };
  }).filter((s) => s.answered > 0);
}
function truthyPresent(a: BriefAnswer): boolean {
  const v = a.verdict as { brand_present?: unknown } | null | undefined;
  return !!v && typeof v === "object" && v.brand_present === true;
}
function mentionType(a: BriefAnswer): string {
  const v = a.verdict as { mention_type?: unknown } | null | undefined;
  return v && typeof v === "object" && typeof v.mention_type === "string" ? v.mention_type : "";
}
function prominenceOf(a: BriefAnswer): string {
  const v = a.verdict as { prominence?: unknown } | null | undefined;
  return v && typeof v === "object" && typeof v.prominence === "string" ? v.prominence : "";
}
/** A tally on a base that is NOT the scored base. Every sentence states its
 *  own denominator, so it reads as a separate fact next to the headline. */
interface OffBaseFact {
  key: (typeof OFF_BASE_STAGES)[number];
  answered: number;
  recommended: number;
  present: number;
  sentence: string;
}

function offBaseFacts(answers: BriefAnswer[]): OffBaseFact[] {
  const facts: OffBaseFact[] = [];
  for (const key of OFF_BASE_STAGES) {
    const rows = answers.filter((a) => a.qtype === key && a.ok !== false);
    if (rows.length === 0) continue;
    const recommended = rows.filter((a) => mentionType(a) === "recommended").length;
    const present = rows.filter((a) => truthyPresent(a)).length;
    const n = rows.length;
    // `rows` are ANSWER rows (one per engine per question), not questions —
    // four engines asked one branded question produce four rows. The noun has
    // to match what was counted or the sentence overstates the question set.
    const noun =
      key === "branded"
        ? `the ${n} answer${n === 1 ? "" : "s"} to questions that name you`
        : `the ${n} head-to-head answer${n === 1 ? "" : "s"}`;
    const sentence =
      recommended > 0
        ? `In ${noun}, the engines back you in ${recommended}.`
        : present > 0
          ? `In ${noun}, the engines name you in ${present} and recommend you in none.`
          : `In ${noun}, the engines do not name you at all.`;
    facts.push({ key, answered: n, recommended, present, sentence });
  }
  return facts;
}

/* ============================== story branch ============================== */

/** dominant when the (band-aware) recommended count is ≥80% of scored answered;
 *  thin when fewer than 8 scored answers landed (hero pivots to data honesty);
 *  challenger otherwise. Thin wins over dominant — too little data to crown. */
export function storyBranch(answeredScored: number, recommendedMid: number): BriefStory {
  if (answeredScored < 8) return "thin";
  if (answeredScored > 0 && recommendedMid >= 0.8 * answeredScored) return "dominant";
  return "challenger";
}

/* ================================ hero ==================================== */

function heroStats(ctx: Ctx): { label: string; value: string; href?: string }[] {
  const stats: { label: string; value: string; href?: string }[] = [
    { label: "Recommended", value: `${ctx.recDisplay} of ${ctx.answered}` },
    // deep-links into the dossier's per-question verdict table (same anchor
    // the "Question verdicts" cards use — see anchor: "verdicts" below)
    { label: "Mentioned", value: `${ctx.mentioned} of ${ctx.answered}`, href: "verdicts" },
  ];
  const tr = ctx.rival;
  if (tr) {
    // a tie is stated, not broken silently: "Upcheck · 9 mentions (tied)"
    stats.push({
      label: "Top rival",
      value: `${clean(tr.name)} · ${tr.count} mentions${tr.tiedWith.length > 0 ? " (tied)" : ""}`,
      // deep-links into "Who gets mentioned most" (share-of-voice), the
      // section that actually names this rival and its count
      href: "voice",
    });
  } else {
    // ONE opportunity-page definition, shared with the dossier's verdict strip
    const opp = opportunityPages(
      ctx.input.corpus,
      makeRivalOwner(ctx.competitors, ctx.input.corpus),
    ).length;
    stats.push({ label: "Opportunity pages", value: String(opp) });
  }
  return stats;
}

/** The "vs last audit" progress stat. Uses trend.deltaState's
 *  three-state rule over [prev.recommended, this.recommended]: a real move shows
 *  "+2 recommended" / "-3 recommended", a ≤1 swing is honestly "within noise".
 *  Null when there is no prior audit (one point ⇒ deltaState "none"). */
function previousDeltaStat(ctx: Ctx): { label: string; value: string } | null {
  const p = ctx.input.previous;
  if (!p) return null;
  const delta = deltaState([{ rec: p.recommended }, { rec: ctx.recommended }]);
  if (delta.state === "none") return null;
  const value =
    delta.state === "noise"
      ? "within noise"
      : `${delta.d > 0 ? "+" : ""}${delta.d} recommended`;
  return { label: "vs last audit", value };
}

/** The most-cited page in the corpus, for the "which sources decide" clause. */
function topCitedPage(ctx: Ctx): BriefPage | undefined {
  return ctx.input.corpus
    .filter((p) => citationDepth(p.cited_by) > 0)
    .sort((a, b) => citationDepth(b.cited_by) - citationDepth(a.cited_by))[0];
}

/** The first ranked move, for the "what to do about it" clause. */
function topMoveTitle(ctx: Ctx): string | undefined {
  const m = pickTopMoves(groupFixes(ctx.input.fixes), 1)[0];
  const t = m ? clean(m.title) : "";
  return t.length > 0 ? t : undefined;
}

/** When the brand is in NONE of the scored answers, "0 of N" is true but it is
 *  not a report. The hero then leads with the findings that ARE non-zero (who
 *  wins those answers, which source the engines lean on) and the zero stays on
 *  screen in the sub line and the first stat tile. */
function absentHeadline(ctx: Ctx): string {
  const lead = `${ctx.brand} is in none of the ${ctx.answered} scored answers.`;
  const clauses: string[] = [];
  if (ctx.rival) clauses.push(clean(topRivalSentence(ctx.rival)));
  const page = topCitedPage(ctx);
  const host = page ? clean(hostOf(page.final_url ?? page.url) || page.url) : "";
  if (host) clauses.push(`${host} is the page they cite most`);
  if (clauses.length === 0) return `${lead} Here is what the run did capture.`;
  return `${lead} ${clauses.join(", and ")}.`;
}

/** Challenger headline mirrors the dossier lede's sharpest-stage-gap derivation
 *  verbatim (rate = rec/answered per stage, both stages inside the scored base);
 *  falls back to the overall count when the split is not safe to speak. */
function challengerHeadline(ctx: Ctx): string {
  const funnel = funnelOf(ctx.input.answers);
  const rate = (s: FunnelStage) => s.rec / s.answered;
  if (ctx.stageSplitSafe && funnel.length > 0) {
    const weakest = [...funnel].sort((a, b) => rate(a) - rate(b) || b.answered - a.answered)[0];
    const strongest = [...funnel].sort((a, b) => rate(b) - rate(a) || b.answered - a.answered)[0];
    const wNoun = STAGE_NOUN[weakest.key] ?? weakest.key;
    const sNoun = STAGE_NOUN[strongest.key] ?? strongest.key;
    if (weakest.answered >= 2) {
      if (weakest.rec === 0) {
        return strongest.key !== weakest.key && rate(strongest) >= 0.5
          ? `You lose every ${wNoun} answer: 0 of ${weakest.answered} recommend ${ctx.brand}, yet the engines back you in ${strongest.rec} of ${strongest.answered} ${sNoun} questions.`
          : `You lose every ${wNoun} answer: 0 of ${weakest.answered} recommend ${ctx.brand}.`;
      }
      if (weakest.key !== strongest.key && rate(weakest) < rate(strongest)) {
        return `${ctx.brand} is recommended in only ${weakest.rec} of ${weakest.answered} ${wNoun} answers, your weakest stage, against ${strongest.rec} of ${strongest.answered} ${sNoun}.`;
      }
    }
  }
  return `The engines recommend ${ctx.brand} in ${ctx.recDisplay} of ${ctx.answered} scored answers. Here's who wins instead.`;
}

function withDelta(
  ctx: Ctx,
  stats: { label: string; value: string; href?: string }[],
): { label: string; value: string; href?: string }[] {
  const d = previousDeltaStat(ctx);
  return d ? [...stats, d] : stats;
}

/** True when nothing in the scored base landed: not recommended, not even
 *  mentioned. The zero is real, so the hero has to earn its screen elsewhere. */
function brandIsAbsent(ctx: Ctx): boolean {
  return ctx.answered > 0 && ctx.recommended === 0 && ctx.mentioned === 0 && ctx.recMid === 0;
}

/** The base, spelled out once: the two counts the tiles show, in a sentence. */
function countsLine(ctx: Ctx): string {
  return `Recommended in ${ctx.recDisplay} of ${ctx.answered} scored answers, and mentioned in ${ctx.mentioned} of ${ctx.answered}.`;
}

function buildHero(ctx: Ctx, story: BriefStory): Brief["hero"] {
  // Labelled facts on other bases travel with the hero, never inside it.
  const notes = ctx.offBase.map((f) => f.sentence);
  // The four totals, stated ONCE at the top in the same words the disclaimer,
  // the methodology section and the Markdown footer use.
  const basis = `This run: ${totalsLine(ctx.totals)}. ${NUMBERS_BASIS}`;
  if (story === "dominant") {
    return {
      headline: "You're winning. Here's where buyers still get sent elsewhere.",
      sub: `Recommended in ${ctx.recDisplay} of ${ctx.answered} scored answers.`,
      stats: withDelta(ctx, heroStats(ctx)),
      notes,
      basis,
    };
  }
  if (story === "thin") {
    return {
      headline: "Too few answers to call it yet. Here's what this run did capture.",
      sub: `Only ${ctx.answered} scored answer${ctx.answered === 1 ? "" : "s"} landed. We report what moved, and nothing we didn't measure.`,
      stats: withDelta(ctx, [
        { label: "Recommended", value: `${ctx.recDisplay} of ${ctx.answered}` },
        { label: "Answers captured", value: String(ctx.answeredTotal) },
        { label: "Mentioned", value: `${ctx.mentioned} of ${ctx.answered}`, href: "verdicts" },
      ]),
      notes,
      basis,
    };
  }
  if (brandIsAbsent(ctx)) {
    const move = topMoveTitle(ctx);
    const zero = countsLine(ctx);
    return {
      headline: absentHeadline(ctx),
      sub: move
        ? `${zero} First move: ${move}.`
        : `${zero} The rivals and pages below are where that gets decided.`,
      stats: withDelta(ctx, heroStats(ctx)),
      notes,
      basis,
    };
  }
  return {
    headline: challengerHeadline(ctx),
    // The headline carries the narrative; the sub carries the two counts the
    // tiles show, so both read off the one base and never repeat each other.
    sub: countsLine(ctx),
    stats: withDelta(ctx, heroStats(ctx)),
    notes,
    basis,
  };
}

/* ============================ card composers ============================== */
// Each returns a BriefCard or null (self-hide). Order/inclusion is decided by
// the story deck below; followups are filtered to existing ids at the end.

// --- am-i-in-the-answer (scores + band) → the verdicts section ------------
function cardAmIn(ctx: Ctx): BriefCard | null {
  if (ctx.answered <= 0) return null;
  const per = ctx.input.scores?.per_engine ?? {};
  const bars: BriefBar[] = Object.entries(per)
    .filter(([, v]) => (v?.answered ?? 0) > 0)
    .map(([engine, v]) => {
      const rep =
        ctx.input.answers.find((a) => a.engine === engine && mentionType(a) === "recommended") ??
        ctx.input.answers.find((a) => a.engine === engine && a.ok !== false);
      return {
        label: engineLabel(engine),
        count: v.recommended,
        highlight: v.recommended > 0,
        receipt: rep ? answerReceipt(ctx, rep.qid, engine) : undefined,
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const strong = bars.filter((b) => b.count > 0);
  const zero = bars.filter((b) => b.count === 0);
  const takeaway =
    strong.length > 0 && zero.length > 0
      ? `${strong[0].label} backs you most; ${zero.map((z) => z.label).join(", ")} never does.`
      : strong.length === 0
        ? "No engine recommends you yet in a scored answer."
        : "Every engine recommends you at least once.";

  // The prominence story: when the brand appears, WHERE does it
  // stand? verdict.prominence "first" = named first; buriedBehind gives the
  // answers where it sits below rivals (with a receipt to one). Counts only when
  // real; each row self-hides at zero. Buried>0 is the signal-worthy line.
  // Counted on the SAME base as the card: scored answers only, so a prominence
  // row can never be read against a denominator it was not measured on.
  const scoredOk = ctx.input.answers.filter((a) => a.ok !== false && isScored(a.qtype ?? ""));
  const namedFirst = scoredOk.filter((a) => prominenceOf(a) === "first").length;
  const buried = buriedBehind(scoredOk, ctx.brand, ctx.aliases);
  const buriedCount = scoredOk.filter((a) => prominenceOf(a) === "buried").length;
  const ofBase = (n: number): string =>
    ctx.stageSplitSafe ? `${n} of ${ctx.answered}` : `${n} answer${n === 1 ? "" : "s"}`;
  const promRows: Extract<BriefBlock, { kind: "kv" }>["rows"] = [];
  if (namedFirst > 0) {
    promRows.push({ k: "Named first", v: ofBase(namedFirst) });
  }
  if (buriedCount > 0) {
    const b0 = buried[0];
    promRows.push({
      k: "Buried behind rivals",
      v: ofBase(buriedCount),
      receipt: b0 ? answerReceipt(ctx, b0.qid, b0.engine) : undefined,
    });
  }

  return {
    id: "am-i-in-the-answer",
    question: "When buyers ask without naming me, am I in the answer?",
    teaser: finishTeaser(`Recommended in ${ctx.recDisplay} of ${ctx.answered} scored answers.`),
    blocks: [
      {
        kind: "text",
        text: "These are your scored answers: the what-to-buy and problem questions, where a buyer who never names you can still be sent to you. Head-to-head and branded questions are counted separately.",
      },
      {
        kind: "stat",
        label: "Recommended",
        value: `${ctx.recDisplay} of ${ctx.answered}`,
      },
      {
        kind: "stat",
        label: "Mentioned but not recommended",
        value: `${Math.max(0, ctx.mentioned - ctx.recommended)} of ${ctx.answered}`,
      },
      ...(promRows.length > 0 ? [{ kind: "kv" as const, rows: promRows }] : []),
      ...(bars.length > 0
        ? [
            barsOrList(bars, takeaway, (b) =>
              b.count > 0 ? `${b.label}: recommended ${b.count}×` : `${b.label}: not recommended in a scored answer`,
            ),
          ]
        : []),
    ],
    followups: ["who-wins-instead", "do-first"],
    anchor: "verdicts",
  };
}

// --- who-wins-instead (rivalGaps + sov + topRival) → the voice section ----
function cardWhoWins(ctx: Ctx): BriefCard | null {
  const gaps = rivalGaps(ctx.input.answers, ctx.input.corpus, ctx.brand, ctx.aliases);
  if (!gaps || gaps.rivals.length === 0) return null;
  const rows: BriefBar[] = gaps.rivals.slice(0, 5).map((r) => ({
    label: clean(r.name),
    count: r.count,
    highlight: false,
    receipt: r.refs[0] ? refReceipt(ctx, r.refs[0]) : undefined,
  }));
  const lead = gaps.rivals[0];
  // Every why is a `quote` block attributed to its rival
  // owner and openable via that rival's first receipt. Whys stream in rival-rank
  // order; empty/attribution-less ones are dropped, max 3. The quote text is the
  // engine's verbatim reason (passthrough — never de-dashed).
  const whyQuotes: BriefBlock[] = gaps.rivals
    .flatMap((r) => r.whys.map((w) => ({ rival: r.name, text: w.text, ref: r.refs[0] })))
    .filter((x) => clean(x.text).length > 0 && clean(x.rival).length > 0)
    .slice(0, 3)
    .map((x) => ({
      kind: "quote",
      text: quote(x.text),
      attribution: clean(x.rival),
      receipt: x.ref ? refReceipt(ctx, x.ref) : undefined,
    }));
  return {
    id: "who-wins-instead",
    question: "When the engines skip me, who do they pick instead, and why?",
    teaser: finishTeaser(
      `Across all question types, ${lead.name} appears in ${lead.count} of the ${gaps.totalAbsentAnswers} answers that skip you.`,
    ),
    blocks: [
      barsOrList(
        rows,
        `Across the ${gaps.totalAbsentAnswers} answers you never appear in, counting every question type and not only the ${ctx.answered} scored ones, these rivals keep coming back.`,
        (b) => `${b.label}: ${b.count} answer${b.count === 1 ? "" : "s"}`,
      ),
      ...whyQuotes,
    ],
    followups: ["deciding-pages", "do-first"],
    anchor: "voice",
  };
}

// --- sent-elsewhere (sendElsewhere) → the voice section -------------------
function cardSentElsewhere(ctx: Ctx): BriefCard | null {
  const se = sendElsewhere(ctx.input.answers, ctx.brand, ctx.aliases);
  // Steers now hold only rivals with ≥2 segments; single-segment rivals
  // collapse into se.singleSteerRivals. Render whenever either has signal.
  if (!se || (se.steers.length === 0 && se.singleSteerRivals === 0)) return null;
  const hasSteers = se.steers.length > 0;
  const rows: BriefBar[] = se.steers.slice(0, 5).map((s) => ({
    label: clean(s.winner),
    count: s.count,
    highlight: false,
    receipt: s.items[0] ? answerReceipt(ctx, s.items[0].qid, s.items[0].engine) : undefined,
  }));
  // Each concrete steer becomes a `quote` block — the segment + the
  // engine's verbatim reason — attributed "{Winner} · {Engine}" and openable.
  const steerQuotes: BriefBlock[] = se.steers.slice(0, 3).flatMap((s) =>
    s.items.slice(0, 2).map((it) => ({
      kind: "quote" as const,
      text: quote(it.reason ? `${clean(it.segment)}: ${clean(it.reason)}` : `${clean(it.segment)} picks ${clean(s.winner)}`),
      attribution: `${clean(s.winner)} · ${engineLabel(it.engine)}`,
      receipt: answerReceipt(ctx, it.qid, it.engine),
    })),
  );
  const singleLine =
    se.singleSteerRivals > 0
      ? `+${se.singleSteerRivals} more rival${se.singleSteerRivals === 1 ? " was" : "s were"} steered a single segment each.`
      : "";
  const totalSteers = se.steers.reduce((n, s) => n + s.count, 0) + se.singleSteerRivals;
  const blocks: BriefBlock[] = [];
  if (hasSteers) {
    blocks.push(
      barsOrList(
        rows,
        se.ownSegments.length > 0
          ? `You stay the default for ${se.ownSegments.slice(0, 3).map((s) => clean(s.phrase)).join(", ")}.`
          : `The engines named ${totalSteers} conditional steer${totalSteers === 1 ? "" : "s"} away from you.`,
        (b) => `${b.label}: ${b.count} segment${b.count === 1 ? "" : "s"}`,
      ),
    );
    blocks.push(...steerQuotes);
    if (singleLine) blocks.push({ kind: "text", text: singleLine });
  } else {
    blocks.push({ kind: "text", text: singleLine });
  }
  const teaser = hasSteers
    ? `${se.steers[0].winner} wins ${se.steers[0].count} of the ${totalSteers} steer conditions the engines named.`
    : `${se.singleSteerRivals} rival${se.singleSteerRivals === 1 ? "" : "s"} each pulled a single buyer segment away from you.`;
  return {
    id: "sent-elsewhere",
    question: "For which buyers do the engines steer to someone else?",
    teaser: finishTeaser(teaser),
    blocks,
    followups: ["who-wins-instead", "deciding-pages"],
    anchor: "voice",
  };
}

// --- deciding-pages (battlefield opportunities + consensusSources) -------
function cardDecidingPages(ctx: Ctx): BriefCard | null {
  const owner = makeRivalOwner(ctx.competitors, ctx.input.corpus);
  const consensus = consensusSources(ctx.input.corpus, owner);
  const opps = battlefieldRows(ctx.input.corpus, owner, true).filter((r) => r.isOpportunity);
  if (consensus.length === 0 && opps.length === 0) return null;
  // Prefer the panel-consensus pages (≥2 engines, brand-absent, winnable); fall
  // back to the ranked opportunities when no page cleared the consensus bar.
  const source =
    consensus.length > 0
      ? consensus.map((c) => c.page)
      : opps.slice(0, 6).map((o) => o.page);
  // A full `pages` table — host, url, title, total citations, the
  // engines that cite it, brand presence, and the page receipt (≤6 rows).
  const pageRows = source.slice(0, 6).map((page) => {
    const qids = page.cited_for_qids ?? [];
    const shownQ = qids.slice(0, 4);
    const moreQ = qids.length - shownQ.length;
    const decides =
      shownQ.length > 0
        ? `decides ${shownQ.join(" · ")}${moreQ > 0 ? ` +${moreQ}` : ""}`
        : undefined;
    return {
      host: clean(hostOf(page.final_url ?? page.url) || page.url),
      url: page.final_url ?? page.url,
      title: page.title ? clean(page.title) : undefined,
      cited: citationDepth(page.cited_by),
      engines: citingEngines(page.cited_by),
      present: page.brand_present ?? null,
      decides,
      receipt: pageReceipt(page),
    };
  });
  // The headline counts the rows the table actually shows, never the full
  // candidate set — a "8 pages" lede over a 6-row table is a number the reader
  // cannot check. The remainder is stated as its own line instead.
  // ONE count for the concept: the full consensus set, the same number the
  // dossier's card shows. The table is capped at 6 rows, so the remainder is
  // stated on its own line rather than silently changing the headline number.
  const total = consensus.length > 0 ? consensus.length : opps.length;
  const n = pageRows.length;
  const more = Math.max(0, total - n);
  const moreLine = more > 0 ? ` The table shows the top ${n}; ${more} more are in the full report.` : "";
  return {
    id: "deciding-pages",
    question: "Which pages decide these answers, and am I on them?",
    teaser: finishTeaser(
      consensus.length > 0
        ? `${total} page${total === 1 ? "" : "s"} ${CONSENSUS_PHRASE} cite rivals, not you.`
        : `${total} winnable page${total === 1 ? "" : "s"} the engines cite that you're absent from.`,
    ),
    blocks: [
      { kind: "pages", rows: pageRows },
      {
        kind: "text",
        text:
          (consensus.length > 0
            ? "Each row shows how many engines cite that page. Two or more of them cite every page here, so winning one moves several engines at once."
            : "These are the cited pages you can realistically get onto.") + moreLine,
      },
    ],
    followups: ["who-wins-instead", "where-from", "do-first"],
    anchor: "battlefield",
  };
}

// --- where-from (buildSourceMap + sourceMix) → the source map ------------
// "Where do the engines get their answers?" Per-engine top cited
// hosts (openable to a page on that host) + the honest channel-mix line. Pure,
// deterministic, self-hides when no engine cited anything.
function cardWhereFrom(ctx: Ctx): BriefCard | null {
  const owner = makeRivalOwner(ctx.competitors, ctx.input.corpus);
  const rates: Record<string, number | null | undefined> = {};
  for (const [engine, v] of Object.entries(ctx.input.scores?.per_engine ?? {})) {
    rates[engine] = v?.mention_rate ?? null;
  }
  const smPages = ctx.input.corpus.map((p) => ({
    page_type: p.page_type ?? "other",
    cited_by: p.cited_by,
    final_url: p.final_url ?? null,
    url: p.url,
    brand_present: p.brand_present ?? null,
  }));
  const map = buildSourceMap(smPages, rates);
  const profiles = map.engines.filter((e) => e.citations > 0 && e.topHosts.length > 0);
  if (profiles.length === 0) return null;

  // host → a corpus page on that host (for the openable receipt)
  const pageByHost = new Map<string, BriefPage>();
  for (const p of ctx.input.corpus) {
    const h = hostOf(p.final_url ?? p.url);
    if (h && !pageByHost.has(h)) pageByHost.set(h, p);
  }
  const kvRows: Extract<BriefBlock, { kind: "kv" }>["rows"] = profiles.map((e) => {
    const hosts = e.topHosts.map((h) => clean(h.host));
    const page = pageByHost.get(e.topHosts[0].host);
    return {
      k: engineLabel(e.engine),
      v: hosts.join(", "),
      receipt: page ? pageReceipt(page) : undefined,
    };
  });

  // the channel-mix line (source-map's per-brand answer), or the source-mix
  // breakdown as a fallback. Both are OUR authored copy → de-dash the connector.
  const mixLine = map.channelMix?.sentence ?? sourceMix(ctx.input.corpus, owner);
  const blocks: BriefBlock[] = [
    { kind: "text", text: "Where each engine drew its answers from, most-cited hosts first:" },
    { kind: "kv", rows: kvRows },
  ];
  if (mixLine) blocks.push({ kind: "text", text: deDash(clean(mixLine)) });

  const lead = profiles[0];
  return {
    id: "where-from",
    question: "Where do the engines get their answers?",
    teaser: finishTeaser(
      map.channelMix
        ? `${Math.round(map.channelMix.share * 100)}% of the pages behind your answers are ${map.channelMix.noun}.`
        : `${engineLabel(lead.engine)} leans on ${lead.topHosts.length} host${lead.topHosts.length === 1 ? "" : "s"} most.`,
    ),
    blocks,
    followups: ["deciding-pages", "do-first"],
    anchor: "source-map",
  };
}

// --- price-claims (mergedPricingClaims) → the verdicts section ------------
// Fixed upstream in report-intel.mergedPricingClaims, shared with the
// dossier PricingStrip so both show the SAME distinct count): markdown-stripped
// re-key, exact-normalized merge, then substring fold — engine attribution union.
function cardPriceClaims(ctx: Ctx): BriefCard | null {
  const claims = mergedPricingClaims(ctx.input.answers);
  if (claims.length === 0) return null;
  const shown = claims.slice(0, 5);
  // Each distinct fee claim is a `quote` block (verbatim engine text),
  // the "N of 4 engines" consensus carried as `count` (≥2 only), openable via its
  // first receipt — no more markdown-ish list lines.
  const claimQuotes: BriefBlock[] = shown.map((c) => ({
    kind: "quote",
    text: quote(c.text),
    count: c.engines.length >= 2 ? c.engines.length : undefined,
    receipt: c.refs[0] ? refReceipt(ctx, c.refs[0]) : undefined,
  }));
  const trimmed = claims.length - shown.length;

  // The number buyers feel is how many DIFFERENT fee FIGURES the engines
  // put on you, not the raw claim count. Fall back to the qualitative count only
  // when the claims carry no numbers at all. Same figures show in the dossier.
  const figures = pricingFigures(claims);
  const figCount = figures.length;
  const FIG_CAP = 6;
  const figShown = figures.slice(0, FIG_CAP);
  const figMore = figCount - figShown.length;
  const figuresLine = `The figures: ${figShown.join(" · ")}${figMore > 0 ? ` · +${figMore} more` : ""}`;

  const blocks: BriefBlock[] = [];
  if (figCount > 0) {
    blocks.push({ kind: "text", text: figuresLine });
  } else if (claims.length > 1) {
    blocks.push({
      kind: "text",
      text: `${claims.length} distinct fee claims are circulating, and buyers see whichever one their engine repeats.`,
    });
  }
  blocks.push(...claimQuotes);
  if (trimmed > 0) {
    blocks.push({ kind: "text", text: `+${trimmed} more fee claim${trimmed === 1 ? "" : "s"} in the full report.` });
  }

  return {
    id: "price-claims",
    question: "What do the engines tell buyers I cost?",
    teaser: finishTeaser(
      figCount > 0
        ? `The engines quote ${figCount} different fee figure${figCount === 1 ? "" : "s"} about you.`
        : `The engines describe your fees ${claims.length} different way${claims.length === 1 ? "" : "s"}.`,
    ),
    blocks,
    followups: ["how-described", "trust-this"],
    anchor: "verdicts",
  };
}

// --- how-described (perception + value_props + entityConfusion) ----------
function cardHowDescribed(ctx: Ctx): BriefCard | null {
  const claims = perceptionClaims(ctx.input.answers);
  const risks = rankRiskClaims(claims);
  const praise = claims
    .filter((c) => c.kind === "praise")
    .sort((a, b) => b.engines.length - a.engines.length || b.count - a.count);
  const vp = (ctx.input.valueProps ?? []).filter((s) => s.trim().length > 0);
  const confusion = entityConfusion(ctx.input.answers);
  if (risks.length === 0 && praise.length === 0 && vp.length === 0 && confusion.length === 0) return null;

  const blocks: BriefBlock[] = [];
  // THE ONE TONE TALLY (report-intel.toneCounts). This card used to count every
  // answer that came back (18) while the dossier counted the answers that name
  // the brand (6): one metric, two published numbers. The denominator is now in
  // the label, so the count can never be read against the wrong base.
  const tone = toneCounts(ctx.input.answers, ctx.brand);
  if (tone.positive > 0 || tone.negative > 0) {
    blocks.push({ kind: "text", text: `${tone.label}:` });
    blocks.push({
      kind: "kv",
      rows: [
        { k: "Positive", v: `${tone.positive} of ${tone.mentioned}` },
        { k: "Neutral", v: `${tone.neutral} of ${tone.mentioned}` },
        { k: "Negative", v: `${tone.negative} of ${tone.mentioned}` },
      ],
    });
    if (tone.confusionNote) blocks.push({ kind: "text", text: tone.confusionNote });
  }
  if (vp.length > 0) {
    // Cap the value-props line at 3.
    // value props are stored brand-model strings that can be model-truncated —
    // tail-tidy each so the line never surfaces a raw "…very long..." fragment.
    blocks.push({ kind: "text", text: `How engines could describe you: ${vp.slice(0, 3).map(quote).join(" · ")}.` });
  }
  if (risks.length > 0) {
    // Each doubt is a `quote` block (verbatim risk text), consensus in
    // `count` (≥2 only), singleton attributed to the one engine, openable.
    blocks.push({ kind: "text", text: "The doubts the engines repeat to buyers:" });
    for (const r of risks.slice(0, 4)) {
      blocks.push({
        kind: "quote",
        text: quote(r.text),
        count: r.engines.length >= 2 ? r.engines.length : undefined,
        attribution: r.engines.length === 1 ? engineLabel(r.engines[0]) : undefined,
        receipt: r.refs[0] ? refReceipt(ctx, r.refs[0]) : undefined,
      });
    }
  }
  if (praise.length > 0) {
    // Praise as `quote` blocks — the "N of 4 engines"
    // count only when ≥2 engines repeat it; a singleton is a plain quote attributed
    // to the one engine (counts before percentages). Openable via its receipt.
    blocks.push({ kind: "text", text: "What the engines credit you for:" });
    for (const p of praise.slice(0, 4)) {
      blocks.push({
        kind: "quote",
        text: quote(p.text),
        count: p.engines.length >= 2 ? p.engines.length : undefined,
        attribution: p.engines.length === 1 ? engineLabel(p.engines[0]) : undefined,
        receipt: p.refs[0] ? refReceipt(ctx, p.refs[0]) : undefined,
      });
    }
  }
  if (confusion.length > 0) {
    blocks.push({
      kind: "list",
      items: confusion.map((c) => ({
        text: `${engineLabel(c.engine)} confused you with another brand in ${c.count} answer${c.count === 1 ? "" : "s"}.`,
        receipt: c.refs[0] ? refReceipt(ctx, c.refs[0]) : undefined,
      })),
    });
  }

  // A SYNTHESIZED sentence (top praise theme + top risk claim),
  // never a raw quote slice. If both halves can't fit ≤90, keep only the doubt.
  const topRisk = risks[0];
  const topPraise = praise[0];
  let teaser: string;
  if (topRisk && topPraise) {
    const both = `Engines praise ${clean(topPraise.text)} and name one doubt: ${clean(topRisk.text)}.`;
    teaser = clean(both).length <= TEASER_MAX ? both : `The engines' main doubt: ${clean(topRisk.text)}.`;
  } else if (topRisk) {
    teaser = `The engines' main doubt: ${clean(topRisk.text)}.`;
  } else if (topPraise) {
    teaser = `Engines praise you for ${clean(topPraise.text)}.`;
  } else if (vp.length > 0) {
    teaser = `The engines could pitch you on ${vp.length} clear strength${vp.length === 1 ? "" : "s"}.`;
  } else {
    teaser = `${confusion.length} engine${confusion.length === 1 ? "" : "s"} confuse you with another brand.`;
  }

  return {
    id: "how-described",
    question: "How do the engines describe me to buyers?",
    teaser: finishTeaser(teaser),
    blocks,
    followups: ["price-claims", "do-first"],
    anchor: "verdicts",
  };
}

// --- bots-read-site (gatesLede + checks) → the gates section --------------
// The flagship live-gate differentiator: not "two sentences, zero
// evidence" but the receipted knock — one `status` row per crawler check.
const STATE_OF = (s: string): "pass" | "fail" | "warn" | "info" =>
  s === "fail" ? "fail" : s === "warn" ? "warn" : s === "info" ? "info" : "pass";
const STATE_SEVERITY: Record<string, number> = { fail: 0, warn: 1, info: 2, pass: 3 };

function cardBotsReadSite(ctx: Ctx): BriefCard | null {
  const gateChecks: GateCheck[] = ctx.input.checks.map((c) => ({
    check_name: c.check_name,
    status: c.status as GateCheck["status"],
    detail: c.detail,
  }));
  const lede = gatesLede(gateChecks, ctx.domain, ctx.input.runDate ?? null);
  if (!lede) return null;
  // The table below shows two kinds of block, and the headline has to name
  // both or it contradicts the rows the reader is looking at: a FAIL is a
  // crawler whose block costs citations, a WARN is a training crawler a site
  // owner may legitimately have blocked on purpose (domainChecks.ts sets the
  // status). Counting only the fails read as "1 blocked" over a table with two
  // blocked rows.
  const isCrawlerCheck = (name: string) => name.startsWith("live fetch as ") || name.startsWith("robots: ");
  const crawlFails = ctx.input.checks.filter((c) => c.status === "fail" && isCrawlerCheck(c.check_name));
  const crawlByChoice = ctx.input.checks.filter((c) => c.status === "warn" && isCrawlerCheck(c.check_name));
  const liveCount = ctx.input.checks.filter((c) => c.check_name.startsWith("live fetch as ")).length;
  const byChoice =
    crawlByChoice.length > 0
      ? `${crawlByChoice.length} more blocked by choice.`
      : "";
  const teaser =
    crawlFails.length > 0
      ? `${crawlFails.length} blocked in a way that costs you citations${byChoice ? `; ${byChoice}` : "."}`
      : crawlByChoice.length > 0
        ? `Nothing blocks the crawlers that cite you; ${crawlByChoice.length} training crawler${crawlByChoice.length === 1 ? " is" : "s are"} blocked by choice.`
        : liveCount > 0
          ? `All ${liveCount} AI crawlers we tested can read your site.`
          : `${ctx.input.checks.length} crawler gates checked; none block the bots.`;

  // EVERY check, most damning first (fail → warn → info → pass). The card used
  // to fold the non-bot passes into a "+3 more checks passed" row while the
  // full report listed all of them, so the two gate tables disagreed. One row
  // set, both formats; the full report is what collapses the passes visually.
  const shownChecks = [...ctx.input.checks].sort(
    (a, b) => STATE_SEVERITY[STATE_OF(a.status)] - STATE_SEVERITY[STATE_OF(b.status)],
  );
  const statusRows: Extract<BriefBlock, { kind: "status" }>["rows"] = shownChecks.map((c) => ({
    label: c.check_name,
    state: STATE_OF(c.status),
    detail: quote(c.detail) || undefined,
  }));
  const tally = gateTally(gateChecks);
  const reconcile = robotsVsLiveNote(gateChecks);

  return {
    id: "bots-read-site",
    question: "Can the AI crawlers even read my site?",
    teaser: finishTeaser(teaser),
    blocks: [
      { kind: "text", text: deDash(quote(`${lede.headline} ${lede.story}`)) },
      { kind: "text", text: `${tally.line} of ${tally.total} checks.` },
      ...(reconcile ? [{ kind: "text" as const, text: reconcile }] : []),
      { kind: "status", rows: statusRows },
    ],
    followups: ["site-coverage", "do-first"],
    anchor: "gates",
  };
}

// --- site-coverage (ownSiteCoverage) → the gates section ------------------
function cardSiteCoverage(ctx: Ctx): BriefCard | null {
  const cov = ownSiteCoverage(ctx.input.sitePages ?? null, ctx.input.corpus, ctx.input.answers, ctx.domain);
  if (!cov) return null;
  const GAP_CAP = 5;
  const gapItems: BriefListItem[] = cov.gaps.slice(0, GAP_CAP).map((g) => {
    const a = ctx.input.answers.find((x) => x.qid === g.qid);
    return {
      text: clean(g.question || g.qid),
      receipt: a ? answerReceipt(ctx, g.qid, a.engine) : undefined,
    };
  });
  const gapMore = cov.gaps.length - Math.min(cov.gaps.length, GAP_CAP);
  if (gapMore > 0) gapItems.push({ text: `+${gapMore} more in the full report.` });

  const blocks: BriefBlock[] = [
    {
      kind: "stat",
      label: "Buyer questions your own pages are cited for",
      value: `${cov.coveredCount} of ${cov.totalQuestions}`,
    },
  ];
  if (gapItems.length > 0) {
    blocks.push({ kind: "text", text: "Questions no page of yours is cited for:" });
    blocks.push({ kind: "list", items: gapItems });
  }
  // Covered examples when the gap list is short (a near-complete site still wants
  // its wins shown). Covered = a scored question with no gap; capped at 3.
  if (cov.gaps.length <= 2 && cov.coveredCount > 0) {
    const gapQids = new Set(cov.gaps.map((g) => g.qid));
    const coveredExamples: BriefListItem[] = [];
    const seen = new Set<string>();
    for (const a of ctx.input.answers) {
      if (a.ok === false || gapQids.has(a.qid) || seen.has(a.qid)) continue;
      const q = clean(a.question || "");
      if (!q) continue;
      seen.add(a.qid);
      coveredExamples.push({ text: q, receipt: answerReceipt(ctx, a.qid, a.engine) });
      if (coveredExamples.length >= 3) break;
    }
    if (coveredExamples.length > 0) {
      blocks.push({ kind: "text", text: "Questions your pages already win:" });
      blocks.push({ kind: "list", items: coveredExamples });
    }
  }

  return {
    id: "site-coverage",
    question: "Does my own site answer the questions buyers ask?",
    teaser: finishTeaser(
      `Your pages are cited for ${cov.coveredCount} of ${cov.totalQuestions} buyer questions.`,
    ),
    blocks,
    followups: ["do-first", "deciding-pages"],
    anchor: "gates",
  };
}

// --- do-first (pickTopMoves on groupFixes) → the fix plan -----------------
function moveRow(g: FixGroup<BriefFix>, rank: number): Extract<BriefBlock, { kind: "moves" }>["rows"][number] {
  // top child = highest weight (groupFixes sorts children by weight DESC).
  const top = g.fixes[0];
  const engines = new Set<string>();
  for (const f of g.fixes) for (const e of f.engines ?? []) if (e) engines.add(e);
  const draftReady = g.fixes.some((f) => !!(f.artifact && f.artifact.trim().length > 0));
  return {
    rank,
    title: clean(g.title), // FULL verb title, never truncated — the view wraps.
    effort: top?.effort && top.effort.trim() ? top.effort.trim() : undefined,
    timeToImpact: top?.time_to_impact && top.time_to_impact.trim() ? top.time_to_impact.trim() : undefined,
    engines: engines.size > 0 ? [...engines].map(engineLabel) : undefined,
    draftReady,
  };
}

function cardDoFirst(ctx: Ctx): BriefCard | null {
  const moves = pickTopMoves(groupFixes(ctx.input.fixes), 3);
  if (moves.length === 0) return null;
  const rows = moves.map((m, i) => moveRow(m, i + 1));
  const readyCount = rows.filter((r) => r.draftReady).length;
  const blocks: BriefBlock[] = [{ kind: "moves", rows }];
  if (readyCount > 0) {
    blocks.push({
      kind: "text",
      text:
        readyCount === rows.length
          ? "Every move's draft is written. Copy it from the full plan."
          : `${readyCount} of these moves ship with a drafted pitch. Copy it from the full plan.`,
    });
  }
  return {
    id: "do-first",
    question: "What should I fix first, and what will it move?",
    teaser: finishTeaser(
      `Your top ${moves.length} move${moves.length === 1 ? "" : "s"}, ranked by the evidence behind each.`,
    ),
    blocks,
    followups: ["who-wins-instead", "deciding-pages"],
    anchor: "fix-plan",
  };
}

// --- trust-this (band + degradedEngines + snapshot honesty) → the method --
function cardTrustThis(ctx: Ctx): BriefCard | null {
  if (ctx.answered <= 0) return null;
  const degraded = degradedEngines(ctx.input.health ?? null);

  // A `kv` method table, honest real values only.
  const kv: Extract<BriefBlock, { kind: "kv" }>["rows"] = [];
  if (ctx.bandKind === "range") {
    kv.push({ k: "Sampled", v: "every scored question re-asked to measure the spread" });
    kv.push({ k: "Range we saw", v: `${ctx.recDisplay} of ${ctx.answered}` });
  } else if (ctx.bandKind === "point") {
    kv.push({ k: "Sampled", v: "every scored question re-asked; the number held" });
    kv.push({ k: "Stable at", v: `${ctx.recDisplay} of ${ctx.answered}` });
  }
  const ha = ctx.input.health?.answers;
  if (ha && typeof ha === "object") {
    const entries = Object.entries(ha);
    if (entries.length > 0) {
      const exp = entries.map(([, v]) => (typeof v?.expected === "number" ? v.expected : 0));
      const got = entries.map(([, v]) => (typeof v?.got === "number" ? v.got : 0));
      const full = entries.filter(
        ([, v]) => (v?.expected ?? 0) > 0 && (v?.got ?? 0) >= (v?.expected ?? 0),
      ).length;
      const uniform = exp.every((e) => e === exp[0]) && got.every((gv) => gv === got[0]);
      kv.push({
        k: "Engines answered",
        v: uniform && exp[0] > 0 ? `${full} of ${entries.length} (${got[0]}/${exp[0]} each)` : `${full} of ${entries.length}`,
      });
    }
  }
  kv.push({ k: "Calls made", v: String(ctx.totals.asked) });
  if (ctx.totals.failed > 0) {
    kv.push({ k: "Calls that returned nothing", v: `${ctx.totals.failed} of ${ctx.totals.asked}` });
  }
  kv.push({ k: "Scored answers", v: String(ctx.answered) });
  kv.push({
    k: "What counts as scored",
    v: "the what-to-buy and problem questions, one answer per question and engine; branded and head-to-head questions are counted separately",
  });
  if (ctx.input.previous) kv.push({ k: "Last audit", v: ctx.input.previous.date });
  kv.push({ k: "Method", v: "the same frozen questions, re-asked on every run" });

  const blocks: BriefBlock[] = [
    {
      kind: "text",
      text: "This is one run, a labelled snapshot, not a trend. Movement is only ever measured by re-asking the exact same questions later and comparing the two runs.",
    },
    { kind: "kv", rows: kv },
  ];
  if (degraded.length > 0) {
    blocks.push({
      kind: "list",
      items: degraded.map((d) => ({
        text: `${engineLabel(d.engine)} answered ${d.got} of ${d.expected} this run; treat its column as low-confidence.`,
      })),
    });
  }
  const teaser =
    ctx.bandKind === "range"
      ? `One snapshot: recommended ranged ${ctx.recDisplay} of ${ctx.answered} across re-asks.`
      : `One labelled snapshot of ${ctx.answered} scored answers, no trend implied.`;
  return {
    id: "trust-this",
    question: "How much can I trust this?",
    teaser: finishTeaser(teaser),
    blocks,
    followups: ["am-i-in-the-answer", "do-first"],
    anchor: "method",
  };
}

/* ============================== assembler ================================= */

const DOMINANT_ORDER = [
  "sent-elsewhere",
  "who-wins-instead",
  "price-claims",
  "deciding-pages",
  "where-from",
  "how-described",
  "bots-read-site",
  "site-coverage",
  "do-first",
  "trust-this",
  "am-i-in-the-answer",
];
const CHALLENGER_ORDER = [
  "am-i-in-the-answer",
  "who-wins-instead",
  "deciding-pages",
  "where-from",
  "do-first",
  "sent-elsewhere",
  "price-claims",
  "bots-read-site",
  "how-described",
  "site-coverage",
  "trust-this",
];
// Thin: fewer cards — the hero already carries the data-honesty message.
const THIN_ORDER = ["am-i-in-the-answer", "do-first", "bots-read-site", "trust-this"];

type Composer = (ctx: Ctx) => BriefCard | null;
const COMPOSERS: Record<string, Composer> = {
  "am-i-in-the-answer": cardAmIn,
  "who-wins-instead": cardWhoWins,
  "sent-elsewhere": cardSentElsewhere,
  "deciding-pages": cardDecidingPages,
  "where-from": cardWhereFrom,
  "price-claims": cardPriceClaims,
  "how-described": cardHowDescribed,
  "bots-read-site": cardBotsReadSite,
  "site-coverage": cardSiteCoverage,
  "do-first": cardDoFirst,
  "trust-this": cardTrustThis,
};

export function buildBrief(input: BriefInput): Brief {
  const scores = input.scores;
  const answered = scores?.overall?.answered ?? 0;
  const recommended = scores?.overall?.recommended ?? 0;
  const mentioned = scores?.overall?.mentioned ?? 0;
  const band = bandDescriptor(scores?.recommended_band?.overall ?? null);
  const recDisplay = band.kind === "range" ? `${band.min}–${band.max}` : String(recommended);
  const recMid =
    band.kind === "range" ? (band.min + band.max) / 2 : band.kind === "point" ? band.min : recommended;

  const answerByRef = new Map<string, BriefAnswer>();
  for (const a of input.answers) answerByRef.set(`${a.qid}|${a.engine}`, a);

  // THE ONE DENOMINATOR RULE: `answered` is the base. The rows in hand are only
  // allowed to split that base when they add up to it, which is the case for a
  // complete run and not for a trimmed or sampled export.
  const scoredHeld = input.answers.filter((a) => a.ok !== false && isScored(a.qtype ?? "")).length;

  const rival = topRivalPick(
    sovEntries(scores?.share_of_voice),
    input.brand.name,
    // the ordering the rival section uses: appearances in the answers that skip
    // you, so a share-of-voice TIE resolves to the same name in both places.
    (rivalGaps(input.answers, input.corpus, input.brand.name, input.brand.aliases ?? [])?.rivals ?? []).map(
      (r) => r.name,
    ),
  );

  const ctx: Ctx = {
    brand: input.brand.name,
    domain: input.brand.domain,
    aliases: input.brand.aliases ?? [],
    competitors: input.brand.competitors ?? [],
    answered,
    recommended,
    mentioned,
    recDisplay,
    recMid,
    bandKind: band.kind,
    answeredTotal: input.answers.filter((a) => a.ok !== false).length,
    scoredHeld,
    stageSplitSafe: answered > 0 && scoredHeld === answered,
    offBase: scoredHeld === answered ? offBaseFacts(input.answers) : [],
    totals: runTotals(input.answers, answered),
    rival,
    answerByRef,
    input,
  };

  const story = storyBranch(answered, recMid);
  const order =
    story === "dominant" ? DOMINANT_ORDER : story === "thin" ? THIN_ORDER : CHALLENGER_ORDER;

  const cards: BriefCard[] = [];
  for (const id of order) {
    // In the dominant story the hero already answers "am I in the answer?", so
    // that card is only worth a slot when the confidence band adds new signal.
    if (story === "dominant" && id === "am-i-in-the-answer" && band.kind === "none") continue;
    const card = COMPOSERS[id](ctx);
    if (card) cards.push(card);
  }

  // Keep every followup pointing at a card that actually rendered.
  const present = new Set(cards.map((c) => c.id));
  for (const c of cards) c.followups = c.followups.filter((f) => present.has(f) && f !== c.id).slice(0, 3);

  return { story, hero: buildHero(ctx, story), cards };
}
