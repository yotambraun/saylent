// REPORT INTEL (see METHODOLOGY.md — evidence-first; the dossier's battlefield
// + verdict sections). Pure, unit-tested computation for the paid Dossier so
// dossier.tsx renders only. A data-gold audit on 36 real stored runs proved
// each of these:
//   1. rival-OWNED pages were mislabelled as ABSENT-opportunities (a brand told
//      "you're absent from a rival's docs site" when the rival OWNED that
//      site). Honesty guard.
//   2. the battlefield ranked a 1-engine deep page above 3-engine consensus pages.
//   3. risk claims were a flat deduped list; the widest-agreed doubt was buried.
//   4. 23/42 "buried" answers name the rivals sitting ahead of the brand.
//   5. per losing question there is a single cited page beating the brand.
// src/engine/ is PURE (no Next/Supabase); we read verdict jsonb tolerantly via
// verdict-compat. Relative import mirrors rival-gaps.ts (value import, not type).
import { normClaims, normOtherBrands } from "@saylent/engine/verdict-compat";
import { previewText, stripMarkdownForPreview } from "./strip-md";

/* ---------- structural row shapes (subsets of the dossier DB rows) ---------- */

/** Minimal page shape — a structural subset of the dossier's CorpusRow, so the
 *  view passes its RLS-fetched rows straight through and gets them back. */
export interface IntelPage {
  url: string;
  final_url?: string | null;
  title?: string | null;
  page_type?: string;
  cited_by: Record<string, number>;
  cited_for_qids: string[];
  brand_present?: boolean | null;
  competitors_present: string[];
  opportunity: boolean;
}

/** Anything verdict-shaped: typed Verdict or loose DB jsonb. Read tolerantly. */
type VerdictLike =
  | {
      brand_present?: unknown;
      mention_type?: unknown;
      prominence?: unknown;
      other_brands?: unknown;
      claims?: unknown;
      sentiment?: unknown;
      // Additions layered on later (optional; absent on older rows):
      segments?: unknown;
      pricing_claims?: unknown;
      entity_confusion?: unknown;
    }
  | null
  | undefined;

/** Minimal answer shape — a structural subset of the dossier's AnswerRow. */
export interface IntelAnswer {
  qid: string;
  qtype?: string;
  question?: string;
  engine: string;
  ok?: boolean;
  verdict?: VerdictLike;
}

/** host → owning-competitor name (null = unowned). Built by makeRivalOwner in
 *  src/lib/rival-owner.ts; injected so the intel + the engine share ONE guard. */
export type RivalOwnerFn = (host: string) => string | null;

/* ---------------------------- small primitives ---------------------------- */

/** How many DISTINCT engines cited this page (the "consensus" signal). A page
 *  cited by 3 engines once each beats a page one engine cited 7×. */
export function engineCount(cited_by: Record<string, number>): number {
  let n = 0;
  for (const v of Object.values(cited_by)) if ((v ?? 0) > 0) n += 1;
  return n;
}

/** Total citations (the old "depth" sort key) — kept as the tiebreak. */
export function citationDepth(cited_by: Record<string, number>): number {
  return Object.values(cited_by).reduce((s, n) => s + (n ?? 0), 0);
}

const norm = (s: string) => s.trim().toLowerCase();

/** Registrable-ish host of the page's effective (post-redirect) URL. */
export function pageHost(page: IntelPage): string {
  const u = page.final_url ?? page.url;
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** The competitor that OWNS this page (Atlassian owns a jira page), else null. */
export function pageOwner(page: IntelPage, rivalOwner: RivalOwnerFn): string | null {
  const h = pageHost(page);
  return h ? rivalOwner(h) : null;
}

/* ------------------- Task 1 + 2: battlefield sort + mix -------------------- */

export interface BattlefieldRow<P extends IntelPage> {
  page: P;
  total: number;
  engineCount: number;
  /** owning competitor name when the page is a rival's OWN site, else null */
  owner: string | null;
  /** an ABSENT-opportunity we can actually win — opportunity AND not rival-owned */
  isOpportunity: boolean;
}

function enrich<P extends IntelPage>(
  page: P,
  rivalOwner: RivalOwnerFn,
  opportunity: Set<P>,
): BattlefieldRow<P> {
  const owner = pageOwner(page, rivalOwner);
  return {
    page,
    total: citationDepth(page.cited_by),
    engineCount: engineCount(page.cited_by),
    owner,
    // one definition, shared with the verdict-strip tile and the consensus card
    isOpportunity: opportunity.has(page) && !owner,
  };
}

/**
 * Battlefield rows in display order.
 * Default: by total citations DESC (existing behaviour), tiebreak host.
 * opportunitiesFirst: winnable opportunities first, ranked by CONSENSUS —
 *   (engineCount DESC, depth DESC) — so 3-engine pages the brand is absent from
 *   outrank a single engine's deep favourite. Rival-owned pages are NEVER given
 *   opportunity priority (you can't be added to a competitor's own site).
 */
export function battlefieldRows<P extends IntelPage>(
  pages: P[],
  rivalOwner: RivalOwnerFn,
  opportunitiesFirst: boolean,
): BattlefieldRow<P>[] {
  const opportunity = new Set(opportunityPages(pages, rivalOwner));
  const rows = pages.map((p) => enrich(p, rivalOwner, opportunity));
  const byDepth = (a: BattlefieldRow<P>, b: BattlefieldRow<P>) =>
    b.total - a.total || pageHost(a.page).localeCompare(pageHost(b.page));
  if (!opportunitiesFirst) return [...rows].sort(byDepth);
  const byConsensus = (a: BattlefieldRow<P>, b: BattlefieldRow<P>) =>
    b.engineCount - a.engineCount || b.total - a.total || pageHost(a.page).localeCompare(pageHost(b.page));
  const opps = rows.filter((r) => r.isOpportunity).sort(byConsensus);
  const rest = rows.filter((r) => !r.isOpportunity).sort(byDepth);
  return [...opps, ...rest];
}

export interface ConsensusPage<P extends IntelPage> {
  page: P;
  engineCount: number;
  total: number;
}

/**
 * Task 2 — "Consensus sources": pages the WHOLE panel trusts (≥2 distinct
 * engines) that the brand is absent from and that are NOT a rival's own site.
 * One listing here moves multiple engines at once. Sorted by consensus.
 */
export function consensusSources<P extends IntelPage>(
  pages: P[],
  rivalOwner: RivalOwnerFn,
): ConsensusPage<P>[] {
  return pages
    .filter(
      (p) =>
        p.brand_present === false &&
        engineCount(p.cited_by) >= 2 &&
        pageOwner(p, rivalOwner) === null,
    )
    .map((page) => ({ page, engineCount: engineCount(page.cited_by), total: citationDepth(page.cited_by) }))
    .sort(
      (a, b) =>
        b.engineCount - a.engineCount ||
        b.total - a.total ||
        pageHost(a.page).localeCompare(pageHost(b.page)),
    );
}

/** The phrase for the consensus threshold, said the way the code actually
 *  defines it. "The whole panel" was false on its face: the bar is 2 of the 4
 *  engines, and every listed page said "3 engines" or "2 engines". */
export const CONSENSUS_PHRASE = "2+ engines trust";

/**
 * THE ONE OPPORTUNITY-PAGE DEFINITION. `corpus_pages.opportunity` is written by
 * the engine, but a bundle can carry it unpopulated (every row false) while the
 * same pages are plainly absent-and-cited — which is how the verdict strip came
 * to show "0 opportunity pages" two cards above "8 pages you're absent from".
 * So: use the stored flag when ANY row carries it, and otherwise derive it the
 * way the consensus card does (brand verified absent, cited by 2+ engines, not
 * a rival's own site). One function, one number, both cards.
 */
export function opportunityPages<P extends IntelPage>(
  pages: P[],
  rivalOwner: RivalOwnerFn,
): P[] {
  const flagged = pages.filter((p) => p.opportunity && pageOwner(p, rivalOwner) === null);
  if (pages.some((p) => p.opportunity)) return flagged;
  return consensusSources(pages, rivalOwner).map((c) => c.page);
}

const PAGE_TYPE_LABELS: Record<string, [string, string]> = {
  listicle: ["listicle", "listicles"],
  comparison: ["comparison", "comparisons"],
  review_platform: ["review platform", "review platforms"],
  brand_owned: ["brand site", "brand sites"],
  forum: ["forum thread", "forum threads"],
  wiki: ["wiki page", "wiki pages"],
  news: ["news article", "news articles"],
  docs: ["docs page", "docs pages"],
  video: ["video", "videos"],
  other: ["other page", "other pages"],
};
const typeLabel = (type: string, plural: boolean): string =>
  (PAGE_TYPE_LABELS[type] ?? [type, `${type}s`])[plural ? 1 : 0];

/**
 * Task 1 — the source-mix line above the battlefield table.
 *
 * ONE DENOMINATOR, stated: the total number of cited pages, then the split by
 * page type, then how many of that same total you appear on. The old line
 * ("Built from 9 listicles · 2 other pages … missing from N of the listicles")
 * put a second, differently-based count in the same sentence, one card away
 * from two more; every number here is out of the same N the table below has
 * rows for. `rivalOwner` is kept in the signature (and used for the honest
 * "of which N are a rival's own site" clause) so callers stay unchanged.
 */
export function sourceMix(pages: IntelPage[], rivalOwner: RivalOwnerFn): string | null {
  const t = new Map<string, number>();
  for (const p of pages) {
    const type = p.page_type ?? "other";
    t.set(type, (t.get(type) ?? 0) + 1);
  }
  if (t.size === 0) return null;
  const parts = [...t.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, n]) => `${n} ${typeLabel(type, n !== 1)}`);
  if (parts.length === 0) return null;
  const total = pages.length;
  const present = pages.filter((p) => p.brand_present === true).length;
  const owned = pages.filter((p) => pageOwner(p, rivalOwner) !== null).length;
  const ownedClause = owned > 0 ? ` ${owned} of them sit${owned === 1 ? "s" : ""} on a rival's own domain.` : "";
  return `${total} page${total === 1 ? "" : "s"} cited · ${parts.join(" · ")}. You appear on ${present} of the ${total}.${ownedClause}`;
}

/* ----------------------------- tone counts -------------------------------- */

/** True when the judge marked this answer as being about a DIFFERENT brand that
 *  shares the audited name (verdict.entity_confusion). */
export function isEntityConfused(a: IntelAnswer): boolean {
  const v = a.verdict;
  return !!v && typeof v === "object" && (v as Record<string, unknown>).entity_confusion === true;
}

export interface ToneCounts {
  /** the denominator: answers that came back AND name the brand */
  mentioned: number;
  /** of those, how many the judge flagged as a different brand of the same name */
  confused: number;
  positive: number;
  neutral: number;
  negative: number;
  /** non-zero tallies in fixed order, ready to render */
  rows: { gloss: string; n: number }[];
  /** the denominator, in words, so the count can never be read against 18 or 24 */
  label: string;
  /** the honesty clause when some of those answers were about another brand */
  confusionNote: string | null;
}

/**
 * THE ONE TONE TALLY. The dossier counted sentiment over answers that MENTION
 * the brand (6) and the Markdown counted it over every answer that came back
 * (18): two published formats, one metric, a 3x disagreement. One function now,
 * and the denominator travels in the label.
 */
export function toneCounts(answers: IntelAnswer[], brandName?: string): ToneCounts {
  const mentionedRows = answers.filter(
    (a) => a.ok !== false && !!a.verdict && typeof a.verdict === "object" && a.verdict.brand_present === true,
  );
  const sentimentOf = (a: IntelAnswer): string => {
    const v = a.verdict;
    return v && typeof v === "object" && typeof v.sentiment === "string" ? v.sentiment : "";
  };
  const n = (k: string) => mentionedRows.filter((a) => sentimentOf(a) === k).length;
  const positive = n("positive");
  const neutral = n("neutral");
  const negative = n("negative");
  const confused = mentionedRows.filter(isEntityConfused).length;
  const mentioned = mentionedRows.length;
  const rows = [
    { gloss: "positive", n: positive },
    { gloss: "neutral", n: neutral },
    { gloss: "negative", n: negative },
  ].filter((r) => r.n > 0);
  return {
    mentioned,
    confused,
    positive,
    neutral,
    negative,
    rows,
    // scope in the label: this counts every answer that names the brand, of any
    // question type, so it is a different number from the summary's "of 9"
    // (scored answers) and from section 03 (answers that list or recommend)
    label: `Tone in the ${mentioned} answer${mentioned === 1 ? "" : "s"} that name you, across every question type`,
    confusionNote:
      confused > 0
        ? `${confused} of those ${mentioned} are about a different company that shares the name${brandName ? ` ${brandName}` : ""} (see entity clarity).`
        : null,
  };
}

/* -------------------- Task 3: risk-claim consensus lead -------------------- */

export type ClaimKind = "praise" | "risk" | "neutral_fact";

export interface PerceptionClaim {
  text: string;
  kind: ClaimKind;
  /** distinct engines that made the claim, first-seen order, capped at 4 */
  engines: string[];
  /** how many times the claim was repeated across all answers (repetition) */
  count: number;
  /** receipts to open (one per occurrence) — lets praise/risk items link back to
   *  the exact stored answer that made the claim (accessibility: keyboard/AT access to receipts) */
  refs: AnswerRef[];
  /** EVERY answer this claim came from was flagged entity-confused: the engine
   *  was describing a different brand of the same name, so the claim belongs to
   *  the entity-clarity finding, not to "what they praise" or "what you cost". */
  confused: boolean;
}

/**
 * Every claim the engines made, deduped by lowercased text (first-seen kind +
 * order win, matching the old dossier logic) but now also carrying `count` =
 * total repetitions and `refs` = a receipt per occurrence. Powers both the
 * perception groups and the risk lead.
 */
export function perceptionClaims(answers: IntelAnswer[]): PerceptionClaim[] {
  const seen = new Map<string, PerceptionClaim & { clean: number }>();
  for (const a of answers) {
    if (a.ok === false) continue;
    const confusedAnswer = isEntityConfused(a);
    for (const { text, kind } of normClaims(a.verdict)) {
      if (!text) continue;
      const key = norm(text);
      const entry =
        seen.get(key) ??
        { text, kind: kind as ClaimKind, engines: [], count: 0, refs: [], confused: true, clean: 0 };
      entry.count += 1;
      if (!confusedAnswer) entry.clean += 1;
      if (!entry.engines.includes(a.engine) && entry.engines.length < 4) entry.engines.push(a.engine);
      entry.refs.push({ qid: a.qid, engine: a.engine });
      seen.set(key, entry);
    }
  }
  return [...seen.values()].map(({ clean, ...c }) => ({ ...c, confused: clean === 0 }));
}

/**
 * Task 3 — risk claims ranked by CONSENSUS: (distinct engines DESC, repetition
 * DESC), stable on first-seen. The top one earns the lead treatment
 * ("{k} of 4 engines tell buyers: '…'"); the rest render as before.
 */
export function rankRiskClaims(claims: PerceptionClaim[]): PerceptionClaim[] {
  return claims
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c.kind === "risk")
    .sort((a, b) => b.c.engines.length - a.c.engines.length || b.c.count - a.c.count || a.i - b.i)
    .map((x) => x.c);
}

/* --------------------- Task 4: buried-behind-whom -------------------------- */

export interface BuriedBehind<A extends IntelAnswer> {
  answer: A;
  qid: string;
  engine: string;
  /** the rivals the engine named AHEAD of the (present-but-buried) brand */
  rivals: string[];
}

/**
 * Task 4 — for each answer where the brand IS present but buried, the rivals the
 * engine named ahead of it. Carries the original answer so the view opens its
 * receipt (openAnswer). Only answers that actually name a rival are returned;
 * an empty result means the view falls back to today's plain "buried ×N".
 */
export function buriedBehind<A extends IntelAnswer>(
  answers: A[],
  brand: string,
  aliases: string[] = [],
): BuriedBehind<A>[] {
  const self = new Set([brand, ...aliases].map(norm));
  const out: BuriedBehind<A>[] = [];
  for (const a of answers) {
    if (a.ok === false) continue;
    const v = a.verdict;
    if (!v || typeof v !== "object") continue;
    if ((v as { prominence?: unknown }).prominence !== "buried") continue;
    const rivals: string[] = [];
    const seen = new Set<string>();
    for (const { name } of normOtherBrands(v)) {
      const key = norm(name);
      if (!key || self.has(key) || seen.has(key)) continue;
      seen.add(key);
      rivals.push(name.trim());
    }
    if (rivals.length > 0) out.push({ answer: a, qid: a.qid, engine: a.engine, rivals });
  }
  return out;
}

/* ------------------ Task 5: question → losing-URL loss map ----------------- */

export interface LossRow<P extends IntelPage> {
  qid: string;
  question: string;
  page: P;
  engineCount: number;
  total: number;
  competitors: string[];
}

export interface LossMap<P extends IntelPage> {
  rows: LossRow<P>[];
  /** losing questions with a page we could NOT show above the cap */
  more: number;
  /** questions with at least one answer this run (the honest denominator) */
  totalQuestions: number;
  /** questions no answer recommends the brand for */
  losingQuestions: number;
  /** losing questions that map to a single cited page (rows + more) */
  mappedQuestions: number;
}

const isRecommended = (v: VerdictLike): boolean =>
  !!v && typeof v === "object" && (v as { mention_type?: unknown }).mention_type === "recommended";

/**
 * Task 5 — "The page beating you, per question". For every scored question the
 * brand never wins (no answer recommends it), the single best page cited for it:
 * consensus pages preferred (engineCount DESC, depth DESC), rival-OWNED pages
 * excluded (those get the honest "rival's own site" treatment instead). Capped.
 */
export function lossMap<P extends IntelPage>(
  answers: IntelAnswer[],
  pages: P[],
  rivalOwner: RivalOwnerFn,
  cap = 8,
): LossMap<P> {
  // questions in scope: those with ≥1 answer, none of which recommend the brand
  const byQid = new Map<string, { question: string; won: boolean }>();
  for (const a of answers) {
    if (a.ok === false) continue;
    const e = byQid.get(a.qid) ?? { question: a.question ?? "", won: false };
    if (a.question && !e.question) e.question = a.question;
    if (isRecommended(a.verdict)) e.won = true;
    byQid.set(a.qid, e);
  }
  const rank = (p: P) => ({ ec: engineCount(p.cited_by), depth: citationDepth(p.cited_by) });
  const rows: LossRow<P>[] = [];
  for (const [qid, { question, won }] of byQid) {
    if (won) continue;
    const candidates = pages
      .filter((p) => p.cited_for_qids.includes(qid) && pageOwner(p, rivalOwner) === null)
      .filter((p) => rank(p).depth > 0);
    if (candidates.length === 0) continue;
    const top = [...candidates].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return rb.ec - ra.ec || rb.depth - ra.depth || pageHost(a).localeCompare(pageHost(b));
    })[0];
    rows.push({
      qid,
      question,
      page: top,
      engineCount: rank(top).ec,
      total: rank(top).depth,
      competitors: top.competitors_present,
    });
  }
  rows.sort((a, b) => b.engineCount - a.engineCount || b.total - a.total || a.qid.localeCompare(b.qid));
  const losingQuestions = [...byQid.values()].filter((q) => !q.won).length;
  return {
    rows: rows.slice(0, cap),
    more: Math.max(0, rows.length - cap),
    totalQuestions: byQid.size,
    losingQuestions,
    mappedQuestions: rows.length,
  };
}

/* ---------------------- "Who gets mentioned most" rows ---------------------- */

export interface SovRow {
  name: string;
  count: number;
  isBrand: boolean;
}
export interface ShareOfVoiceRows {
  /** rivals (count ≥ 2) plus the brand row, sorted by count DESC (tiebreak name) */
  rows: SovRow[];
  /** bar-scale max over EVERYTHING rendered — clamps the brand bar to ≤100% */
  scaleMax: number;
  /** rivals mentioned exactly once (the "+N more mentioned once" line) */
  singles: number;
}

/**
 * The "Who gets mentioned most" rows. Two dominant-run bugs this fixes: (1) the brand row was rendered LAST
 * regardless of its count, so an 85-mention brand sat under a 5-mention rival —
 * here the brand row is MERGED into the sorted list at its true position; (2) the
 * bar scale was the rival max only, so a brand whose own count (85) exceeded the
 * top rival (57) rendered a 149%-wide bar — here scaleMax is computed over
 * EVERYTHING, and the caller clamps width to 100%. `entries` is sovEntries()
 * output; `brandCount` is the brand's own tally (its share-of-voice count, or a
 * value computed from its verdicts when the judges never listed it).
 */
export function shareOfVoiceRows(
  entries: [string, number][],
  brand: string,
  brandCount: number,
): ShareOfVoiceRows {
  const brandLc = brand.toLowerCase();
  const rivalRows: SovRow[] = entries
    .filter(([name, count]) => count >= 2 && name.toLowerCase() !== brandLc)
    .map(([name, count]) => ({ name, count, isBrand: false }));
  const rows = [...rivalRows, { name: brand, count: brandCount, isBrand: true }].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
  const scaleMax = Math.max(1, ...rows.map((r) => r.count));
  const singles = entries.filter(
    ([name, count]) => count === 1 && name.toLowerCase() !== brandLc,
  ).length;
  return { rows, scaleMax, singles };
}

/* ============================================================================
 * Surface the mined value the judge already computed. Each function
 * is pure + tolerant: it reads the OPTIONAL extra verdict fields (segments,
 * pricing_claims, entity_confusion) and the run-level snapshots (health,
 * brand_model, site_pages, scores.recommended_band). Old runs lack these fields;
 * every function degrades to null/[] so the view hides the panel entirely.
 * ==========================================================================*/

/** A receipt handle back to the stored answer that carried a finding. */
export interface AnswerRef {
  qid: string;
  engine: string;
}

const readObjArray = (v: VerdictLike, key: string): Record<string, unknown>[] => {
  const raw = v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
};
const readStrArray = (v: VerdictLike, key: string): string[] => {
  const raw = v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
};
const hasArrayField = (v: VerdictLike, key: string): boolean =>
  !!v && typeof v === "object" && Array.isArray((v as Record<string, unknown>)[key]);
const str = (o: Record<string, unknown>, k: string): string =>
  typeof o[k] === "string" ? (o[k] as string).trim() : "";

/* ------------------- Item 1: "Who the engines send elsewhere" -------------- */

export interface SegmentSteer {
  /** the rival the engines steer this segment toward */
  winner: string;
  /** each DISTINCT conditional steer (deduped by normalized segment) + the stated
   *  reason + a receipt. Segment/reason are markdown-stripped for panel display. */
  items: { segment: string; reason: string; qid: string; engine: string }[];
  /** distinct segments steered toward this winner (sort key) */
  count: number;
}
/** A segment phrase the engines make the AUDITED brand the default for, deduped
 *  case-insensitively with its frequency count. Display phrase is md-stripped. */
export interface OwnSegment {
  phrase: string;
  count: number;
}
export interface SendElsewhere {
  /** rivals (never the audited brand) the engines conditionally steer buyers to,
   *  each with ≥2 DISTINCT segments (capped at 8, ranked by segment count) */
  steers: SegmentSteer[];
  /** segment phrases the engines make the AUDITED brand the default for, deduped
   *  + frequency-ranked (the view caps + shows its own "+N more"). */
  ownSegments: OwnSegment[];
  /** distinct rival winners steered exactly ONE segment each — collapsed out of
   *  `steers` into one honest "+N more rivals … a single segment each" line so a
   *  DOMINANT run's ~25 one-off winner blocks don't drown the real steers. */
  singleSteerRivals: number;
}

/** Normalize a segment/winner LABEL for DISPLAY: strip preview markdown, collapse
 *  whitespace, trim. The stored raw stays verbatim behind the receipt. */
const stripSeg = (s: string): string => previewText(s ?? "");

/** Normalize a REASON — a verbatim engine EXCERPT that may be stored pre-cut
 *  mid-word — for display: the pipeline WITH tail-tidy so the steer panel never
 *  shows a raw "…offer at..." fragment. Receipts stay verbatim. */
const stripReason = (s: string): string => previewText(s ?? "", { tail: true });

/** A name reduced to its bare words for self-classification: lowercased, every
 *  non-alphanumeric run (punctuation, asterisks, brackets) folded to one space. */
const nameWords = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Item 1 — aggregate every answer's `verdict.segments` ("pick {winner} if
 * {segment} — {reason}"). A DOMINANT full run mines dozens of near-duplicate,
 * markdown-bearing segment strings, so we normalize (md-strip + casefold) and
 * dedupe: rivals are grouped by winner with their distinct segments (sorted by
 * distinct-segment count); the audited brand's own winning segments are deduped
 * with frequency counts and frequency-ranked for the one honest lead line.
 * Returns null ONLY when NO answer carried a segments field at all (old runs) —
 * a new run with empty segments returns a non-null, empty-ish shape so the view
 * can render its honest "no conditional steers" state.
 */
export function sendElsewhere(
  answers: IntelAnswer[],
  brand: string,
  aliases: string[] = [],
): SendElsewhere | null {
  // self-terms: brand + aliases reduced to bare word phrases. A winner is SELF
  // when its bare-word form contains any self-term as a WHOLE word/phrase — so
  // "Acme Business", "Acme for Business", "Acme (individuals)" and "Acme — Best
  // Overall" all resolve to the audited brand (steering to yourself isn't a
  // steer). "not Acme" is a pure-negation artifact — dropped entirely.
  const selfTerms = [brand, ...aliases].map(nameWords).filter(Boolean);
  const selfRes = selfTerms.map((t) => new RegExp(`\\b${escapeRe(t)}\\b`));
  const isSelfName = (name: string): boolean => {
    const w = nameWords(name);
    return !!w && selfRes.some((re) => re.test(w));
  };
  const isNegatedSelf = (name: string): boolean =>
    /^(not|no)\b/.test(nameWords(name)) && isSelfName(name);
  let sawField = false;
  // winner-key → { winner, distinct-segment-key → item } (dedupe within winner)
  const byWinner = new Map<
    string,
    { winner: string; items: Map<string, { segment: string; reason: string; qid: string; engine: string }> }
  >();
  const ownByKey = new Map<string, OwnSegment>();
  for (const a of answers) {
    if (a.ok === false) continue;
    if (hasArrayField(a.verdict, "segments")) sawField = true;
    for (const o of readObjArray(a.verdict, "segments")) {
      const winner = stripSeg(str(o, "winner")); // (a) strip markdown from winner
      const segment = stripSeg(str(o, "segment"));
      if (!winner || !segment) continue;
      const segKey = segment.toLowerCase();
      if (isNegatedSelf(winner)) continue; // (b) drop "not {brand}" junk entirely
      if (isSelfName(winner)) {
        // (b) self winner → covered by the "default for" line, never a steer
        const hit = ownByKey.get(segKey);
        if (hit) hit.count += 1;
        else ownByKey.set(segKey, { phrase: segment, count: 1 });
        continue;
      }
      const wKey = norm(winner);
      const entry = byWinner.get(wKey) ?? { winner, items: new Map() };
      if (!entry.items.has(segKey)) {
        entry.items.set(segKey, { segment, reason: stripReason(str(o, "reason")), qid: a.qid, engine: a.engine });
      }
      byWinner.set(wKey, entry);
    }
  }
  if (!sawField) return null; // older run — panel absent entirely
  const allWinners = [...byWinner.values()].map((e) => ({
    winner: e.winner,
    items: [...e.items.values()],
    count: e.items.size,
  }));
  // (c) keep only winners with ≥2 distinct segments (max 8, ranked by count);
  // collapse every one-segment winner into a single honest tail count.
  const steers: SegmentSteer[] = allWinners
    .filter((w) => w.count >= 2)
    .sort((a, b) => b.count - a.count || a.winner.localeCompare(b.winner))
    .slice(0, 8);
  const singleSteerRivals = allWinners.filter((w) => w.count === 1).length;
  const ownSegments = [...ownByKey.values()].sort(
    (a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase),
  );
  return { steers, ownSegments, singleSteerRivals };
}

/* -------------------- Item 2: "What the engines say you cost" -------------- */

export interface PricingClaimAgg {
  text: string;
  /** distinct engines that made the claim, first-seen order, capped at 4 */
  engines: string[];
  /** receipts to open (one per occurrence) */
  refs: AnswerRef[];
  /** total repetitions across all answers */
  count: number;
  /** every answer this claim came from was about a DIFFERENT brand of the same
   *  name (verdict.entity_confusion) — a price quoted at someone else. */
  confused: boolean;
}

const normPrice = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;]+$/, "");

/**
 * Item 2 — aggregate every answer's `verdict.pricing_claims`, deduped by
 * normalized text, carrying the distinct engines + receipts + repetition. Sorted
 * by consensus (distinct engines DESC, repetition DESC). Empty ⇒ view hides it.
 */
export function pricingClaims(answers: IntelAnswer[]): PricingClaimAgg[] {
  const seen = new Map<string, PricingClaimAgg & { clean: number }>();
  for (const a of answers) {
    if (a.ok === false) continue;
    const confusedAnswer = isEntityConfused(a);
    for (const raw of readStrArray(a.verdict, "pricing_claims")) {
      const text = raw.trim();
      if (!text) continue;
      const key = normPrice(text);
      const entry = seen.get(key) ?? { text, engines: [], refs: [], count: 0, confused: true, clean: 0 };
      entry.count += 1;
      if (!confusedAnswer) entry.clean += 1;
      if (!entry.engines.includes(a.engine) && entry.engines.length < 4) entry.engines.push(a.engine);
      entry.refs.push({ qid: a.qid, engine: a.engine });
      seen.set(key, entry);
    }
  }
  return [...seen.values()]
    .map(({ clean, ...c }) => ({ ...c, confused: clean === 0 }))
    .sort(
    (a, b) => b.engines.length - a.engines.length || b.count - a.count || a.text.localeCompare(b.text),
  );
}

/** A pricing claim folded to a DISTINCT fee claim for panel display: engine
 *  attribution union + receipts + repetition, text markdown-stripped. */
export interface MergedPricingClaim {
  text: string;
  engines: string[];
  refs: AnswerRef[];
  count: number;
  /** every source answer was entity-confused: this is someone else's price */
  confused: boolean;
}

const mergedPriceKey = (t: string): string =>
  stripMarkdownForPreview(t ?? "").toLowerCase().replace(/\s+/g, " ").replace(/[.,;]+$/, "").trim();
function addMergedEngines(into: MergedPricingClaim, engines: string[]): void {
  for (const e of engines)
    if (e && !into.engines.includes(e) && into.engines.length < 4) into.engines.push(e);
}

/**
 * Item 2 (merged) — `pricingClaims` folded to DISTINCT fee claims. Item 2's
 * `pricingClaims` dedupes by normalized RAW text, so on a DOMINANT full run
 * "**cash pickup**" and "cash pickup" survive as two, and a short claim that is
 * literally a substring of a longer one ("mid-market rate" alone AND inside the
 * "…0.35% fee" sentence) both appear. Here each claim is re-keyed with markdown
 * stripped, exact-normalized duplicates merge, then any claim whose normalized
 * text is a substring of a longer kept one folds in — engine attribution +
 * receipts union, repetition summed. Sorted by consensus. This is the DISTINCT
 * count the dossier PricingStrip and the Brief price-claims card both show.
 */
export function mergedPricingClaims(answers: IntelAnswer[]): MergedPricingClaim[] {
  // exact-normalized (markdown-stripped) merge first
  const exact = new Map<string, MergedPricingClaim>();
  for (const c of pricingClaims(answers)) {
    const key = mergedPriceKey(c.text);
    if (!key) continue;
    const hit = exact.get(key);
    if (hit) {
      addMergedEngines(hit, c.engines);
      hit.count += c.count;
      hit.refs.push(...c.refs);
      hit.confused = hit.confused && c.confused;
    } else {
      exact.set(key, {
        // a pricing claim is a verbatim engine excerpt that may be stored pre-cut
        // mid-word ("…the fine print is comple…") — tail-tidy so the dossier
        // PricingStrip and the Brief both show a clean distinct claim.
        text: previewText(c.text, { tail: true }),
        engines: [...c.engines].slice(0, 4),
        refs: [...c.refs],
        count: c.count,
        confused: c.confused,
      });
    }
  }
  // substring merge: a shorter normalized claim folds into a longer kept one
  const kept: { key: string; claim: MergedPricingClaim }[] = [];
  for (const [key, claim] of [...exact.entries()].sort((a, b) => b[0].length - a[0].length)) {
    const host = kept.find((h) => h.key.includes(key));
    if (host) {
      addMergedEngines(host.claim, claim.engines);
      host.claim.count += claim.count;
      host.claim.refs.push(...claim.refs);
      host.claim.confused = host.claim.confused && claim.confused;
    } else {
      kept.push({ key, claim });
    }
  }
  return kept
    .map((k) => k.claim)
    .sort((a, b) => b.engines.length - a.engines.length || b.count - a.count || a.text.localeCompare(b.text));
}

/**
 * The DISTINCT fee FIGURES the merged claims quote. "N different fee
 * claims" is true but meaningless (a full run mines 100+ near-identical prose
 * claims); the number buyers actually feel is how many DIFFERENT numbers the
 * engines put on you. Extracts normalized numeric fee tokens from the merged
 * claim text: percent ranges ("0.33–0.6%", hyphen or en-dash) kept as ONE token,
 * single percents ("0.35%"), and currency amounts/thresholds ("$31", "$25,000").
 * Deduped by normalized form (spaces stripped, hyphen→en-dash), first-seen order.
 * Zero figures ⇒ the caller falls back to the qualitative "N different ways" copy.
 */
export function pricingFigures(merged: MergedPricingClaim[]): string[] {
  // ordered alternation: a percent RANGE must match before a lone percent so
  // "0.33–0.6%", "0.33%–0.6%" and "0.33-0.6%" are ONE token, not a stray "0.6%".
  const re =
    /\d+(?:\.\d+)?\s*%?\s*[–-]\s*\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%|\$\s?\d[\d,]*(?:\.\d+)?/g;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of merged) {
    for (const m of c.text.matchAll(re)) {
      const norm = m[0]
        .replace(/\s+/g, "")
        .replace(/-/g, "–")
        .replace(/%–/, "–"); // inner % of a both-sided range folds away
      const key = norm.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(norm);
    }
  }
  // rates are the fee story; flat amounts (setup fees, thresholds) trail them.
  const val = (s: string) => parseFloat((s.split("–")[0] || "0").replace(/[^\d.]/g, "") || "0");
  const pct = out.filter((s) => s.endsWith("%")).sort((a, b) => val(a) - val(b));
  const amt = out.filter((s) => !s.endsWith("%")).sort((a, b) => val(a) - val(b));
  return [...pct, ...amt];
}

/* ----------------------- Item 7: entity confusion -------------------------- */

export interface EntityConfusionAgg {
  engine: string;
  count: number;
  refs: AnswerRef[];
}

/**
 * Item 7 — answers where `verdict.entity_confusion === true`, grouped by engine
 * (an entity-clarity problem: the engine mostly discussed a different brand that
 * shares the audited name). Sorted by count DESC. Empty ⇒ view hides it.
 */
export function entityConfusion(answers: IntelAnswer[]): EntityConfusionAgg[] {
  const byEngine = new Map<string, EntityConfusionAgg>();
  for (const a of answers) {
    if (a.ok === false) continue;
    const flag = a.verdict && typeof a.verdict === "object"
      ? (a.verdict as Record<string, unknown>).entity_confusion
      : undefined;
    if (flag !== true) continue;
    const e = byEngine.get(a.engine) ?? { engine: a.engine, count: 0, refs: [] };
    e.count += 1;
    e.refs.push({ qid: a.qid, engine: a.engine });
    byEngine.set(a.engine, e);
  }
  return [...byEngine.values()].sort((a, b) => b.count - a.count || a.engine.localeCompare(b.engine));
}

/* ------------------- Item 3: recommended confidence band ------------------- */

export interface BandLike {
  min: number;
  max: number;
}
export type BandDescriptor = { kind: "range" | "point" | "none"; min: number; max: number };

/** Item 3 — classify a recommended_band: a real range (min≠max), a stable point
 *  (min==max), or none (absent/old run). Pure; the view renders the copy. */
export function bandDescriptor(band: BandLike | null | undefined): BandDescriptor {
  if (!band || typeof band.min !== "number" || typeof band.max !== "number")
    return { kind: "none", min: 0, max: 0 };
  return { kind: band.min === band.max ? "point" : "range", min: band.min, max: band.max };
}

/* -------------------- Item 4: degraded-run health caveat ------------------- */

export interface RunHealthLike {
  answers?: Record<string, { got?: number; expected?: number }> | null;
}
export interface DegradedEngine {
  engine: string;
  got: number;
  expected: number;
}

/**
 * Item 4 — engines that delivered under HALF their expected answers this run
 * (the run-health "degraded" rule, buyer-facing). Reads runs.health.answers.
 * Empty ⇒ no caveat.
 */
export function degradedEngines(health: RunHealthLike | null | undefined): DegradedEngine[] {
  const a = health?.answers;
  if (!a || typeof a !== "object") return [];
  const out: DegradedEngine[] = [];
  for (const [engine, v] of Object.entries(a)) {
    const got = typeof v?.got === "number" ? v.got : 0;
    const expected = typeof v?.expected === "number" ? v.expected : 0;
    if (expected > 0 && got < expected / 2) out.push({ engine, got, expected });
  }
  return out.sort((x, y) => x.engine.localeCompare(y.engine));
}

/* -------------------- Item 5: own-site coverage map ------------------------ */

/** Own-site crawl meta stored on runs.site_pages (migration 0037). No full text:
 *  url + title + optional sitemap <lastmod> date only. */
export interface SitePageMeta {
  url: string;
  title: string;
  date?: string;
}
interface CrawledPageLike {
  url?: unknown;
  title?: unknown;
  date?: unknown;
}

/**
 * Shape a crawlSite() result into the minimal runs.site_pages meta: url + title
 * (+ sitemap date when known), deduped by url, capped. Never carries page text.
 * Pure — the ONE Inngest write imports this so the shape stays tested here.
 */
export function sitePagesMeta(pages: CrawledPageLike[], cap = 25): SitePageMeta[] {
  const out: SitePageMeta[] = [];
  const seen = new Set<string>();
  for (const p of pages) {
    if (out.length >= cap) break;
    const url = typeof p.url === "string" ? p.url.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = typeof p.title === "string" ? p.title.trim() : "";
    const date = typeof p.date === "string" && p.date.trim() ? p.date.trim() : undefined;
    out.push({ url, title, ...(date ? { date } : {}) });
  }
  return out;
}

/** registrable-ish domain: last two labels, www stripped. */
function registrableDomain(hostOrDomain: string): string {
  const host = hostOrDomain
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
  const parts = host.split(".").filter(Boolean);
  return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
}

export interface OwnSiteCoverage {
  /** the crawled own-site pages (meta only) */
  pages: SitePageMeta[];
  /** frozen buyer questions the engines cited NO page of yours for */
  gaps: { qid: string; question: string; qtype: string }[];
  coveredCount: number;
  totalQuestions: number;
}

/**
 * Item 5 — "Your site vs the buyer questions". Anchored on runs.site_pages (the
 * crawled own-site pages); returns null when that snapshot is absent (old runs).
 * A question is COVERED when a page on the brand's own registrable domain was
 * cited for it in this run's corpus; otherwise it is a gap. Honest by
 * construction: "covered" means the engines actually cited your page, not merely
 * that a matching page exists.
 */
export function ownSiteCoverage<P extends IntelPage>(
  sitePages: SitePageMeta[] | null | undefined,
  pages: P[],
  answers: IntelAnswer[],
  brandDomain: string,
): OwnSiteCoverage | null {
  if (!sitePages || sitePages.length === 0) return null; // older run without site-page data
  const brandReg = registrableDomain(brandDomain);
  const coveredQids = new Set<string>();
  if (brandReg) {
    for (const p of pages) {
      const host = pageHost(p);
      if (host && registrableDomain(host) === brandReg) {
        for (const q of p.cited_for_qids) coveredQids.add(q);
      }
    }
  }
  const q = new Map<string, { question: string; qtype: string }>();
  for (const a of answers) {
    if (a.ok === false) continue;
    if (!q.has(a.qid)) q.set(a.qid, { question: a.question ?? "", qtype: a.qtype ?? "" });
  }
  const gaps: OwnSiteCoverage["gaps"] = [];
  for (const [qid, meta] of q) {
    if (!coveredQids.has(qid)) gaps.push({ qid, question: meta.question, qtype: meta.qtype });
  }
  gaps.sort((a, b) => a.qid.localeCompare(b.qid));
  return {
    pages: sitePages,
    gaps,
    coveredCount: q.size - gaps.length,
    totalQuestions: q.size,
  };
}
