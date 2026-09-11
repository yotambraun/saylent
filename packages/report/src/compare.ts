// COMPARE — "you vs a specific rival", composed from ONE done audit run
// (project rule: compare us to a specific rival). Pure + $0:
// every section is derived DETERMINISTICALLY from the stored rows the dossier
// already holds — no LLM at read time, no new statistic invented. Like brief.ts
// and report-intel.ts this file imports NO React/Next/Supabase so it unit-tests
// standalone; the view (brand/[id]/vs) renders it and resolves each receipt to the
// SAME AnswerDrawer/PageDrawer the dossier opens.
//
// Honesty rules (see METHODOLOGY.md) — dominant-scale handling:
// counts before percentages, markdown stripped from every quoted string, every
// number one tap from its receipt, sections self-hide when their data is absent,
// caps carry an honest "+N" tail, and we score recommendations for the AUDITED
// brand only (we never fabricate a rival's recommended rate).
import { isScored } from "@saylent/engine/score";
import { normOtherBrands } from "@saylent/engine/verdict-compat";
import { sovEntries } from "./sov";
import { previewText } from "./strip-md";
import {
  citationDepth,
  engineCount as pageEngineCount,
  type IntelAnswer,
  type IntelPage,
} from "./report-intel";

/* ============================ public types =============================== */

/** A receipt handle back to the stored row backing a number — structurally the
 *  Brief's receipt so the vs-client resolves it through the SAME answer/page
 *  index (id → `qid|engine` composite → url). */
export interface CompareReceipt {
  kind: "answer" | "page";
  id: string;
  label: string;
}

/** Who a single stored answer favours, relative to the chosen rival. Four honest
 *  states, each rendered with a distinct token + glyph (never colour alone). */
export type CellFavor = "you" | "rival" | "both" | "neither";

export interface CompareCell {
  engine: string;
  /** null when this engine gave no scored answer to this question */
  favor: CellFavor | null;
  /** true when the brand was RECOMMENDED (not merely present) in this answer */
  recommended: boolean;
  receipt?: CompareReceipt;
}

export interface CompareRow {
  qid: string;
  question: string;
  qtype: string;
  cells: CompareCell[];
  /** rival appeared in ≥1 cell — the contested rows sort to the top */
  contested: boolean;
}

export interface CompareGrid {
  engines: string[];
  rows: CompareRow[];
  /** honest "+N more scored questions" tail when rows were capped */
  more: number;
}

export interface CompareCount {
  metric: string;
  you: number;
  rival: number;
  youReceipt?: CompareReceipt;
  rivalReceipt?: CompareReceipt;
  /** honesty qualifier shown under the pair (e.g. the scored denominator) */
  note?: string;
}

export interface ComparePage {
  host: string;
  url: string;
  /** total citations across engines (depth) */
  cited: number;
  /** distinct engines that cited the page (consensus) */
  engines: number;
  /** buyer questions this page decides (qids from corpus.cited_for_qids),
   *  sorted for determinism; empty when the page isn't tied to a named answer */
  decides: string[];
  receipt: CompareReceipt;
}
export interface ComparePages {
  pages: ComparePage[];
  more: number;
}

/** One placement bucket in the prominence duel: how often YOU land there in the
 *  answers where you and the rival co-appear. Only non-zero buckets are emitted. */
export interface CompareProminenceLine {
  key: "first" | "early" | "buried";
  label: string;
  count: number;
  receipt?: CompareReceipt;
}
/** "When you both appear, who leads?" — read across the answers that name BOTH
 *  the brand and the chosen rival (co-appearances), tallying YOUR placement. */
export interface CompareProminence {
  /** answers where you AND the rival are both named */
  coAppearances: number;
  namedFirst: number;
  namedEarly: number;
  buried: number;
  /** non-zero placement buckets, each with a receipt to a representative answer */
  lines: CompareProminenceLine[];
  /** representative receipt for the whole section (first co-appearance) */
  leadReceipt?: CompareReceipt;
}

export interface CompareSteer {
  segment: string;
  reason: string;
  receipt?: CompareReceipt;
}
export interface CompareSteers {
  items: CompareSteer[];
  more: number;
}

export interface RivalCompare {
  rival: string;
  /** true when `rival` matched a real rival mined from the run */
  rivalKnown: boolean;
  grid: CompareGrid | null;
  counts: CompareCount[] | null;
  /** the prominence duel — null when you and the rival never co-appear */
  prominence: CompareProminence | null;
  pagesTheyOwn: ComparePages | null;
  steers: CompareSteers | null;
  /** comparability line — one run, like-for-like; the view prepends the date */
  snapshotNote: string;
}

export interface RivalOption {
  name: string;
  /** mention count used for ranking (SOV count, or absent-answer appearances) */
  mentions: number;
}

/* ------------------------- structural inputs ------------------------------ */
// Supersets of report-intel's IntelAnswer / IntelPage (same rows the dossier
// fetches) plus the optional DB `id` so a receipt can carry the exact row.

export interface CompareAnswer extends IntelAnswer {
  id?: string;
}
export interface ComparePageRow extends IntelPage {
  id?: string;
}
export interface CompareScores {
  overall?: { answered?: number; recommended?: number; mentioned?: number };
  share_of_voice?: Record<string, number>;
}
export interface CompareInput {
  brand: { name: string; domain: string; aliases?: string[]; competitors?: string[] };
  scores: CompareScores | null;
  answers: CompareAnswer[];
  corpus: ComparePageRow[];
}

/* ============================ small helpers =============================== */

const ENGINE_ORDER = ["chatgpt", "claude", "gemini", "perplexity"] as const;
const ENGINE_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
};
const engineLabel = (e: string): string =>
  ENGINE_LABEL[e] ?? e.charAt(0).toUpperCase() + e.slice(1);

// The ONE preview pipeline (strip markdown, collapse whitespace, trim). Stored
// raw stays verbatim behind every receipt; only the derived /vs copy is cleaned.
const clean = (s: string): string => previewText(s ?? "");
/** A verbatim engine excerpt shown as a preview (steer reason): pipeline + tail-
 *  tidy, since judge excerpts are stored pre-truncated and must never end
 *  mid-word. The full answer stays one tap away as the verbatim receipt. */
const quote = (s: string): string => previewText(s ?? "", { tail: true });

/** A name reduced to bare words for tolerant matching (Acme Business ⇒ "acme
 *  business"); mirrors report-intel's nameWords so self/rival tests agree. */
const nameWords = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Build a predicate: does a candidate name refer to this entity? True when any
 *  of the entity's terms appears as a WHOLE word/phrase in the candidate's
 *  bare-word form ("Acme" matches "Acme Business", not "Academic"). */
function makeMatcher(terms: string[]): (candidate: string) => boolean {
  const res = terms
    .map(nameWords)
    .filter(Boolean)
    .map((t) => new RegExp(`\\b${escapeRe(t)}\\b`));
  return (candidate: string) => {
    const w = nameWords(candidate);
    return !!w && res.some((re) => re.test(w));
  };
}

const hostOf = (u: string | null | undefined): string => {
  if (!u) return "";
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u ?? "";
  }
};

function answerReceipt(a: CompareAnswer): CompareReceipt {
  return { kind: "answer", id: a.id ?? `${a.qid}|${a.engine}`, label: engineLabel(a.engine) };
}
function pageReceipt(p: ComparePageRow): CompareReceipt {
  return { kind: "page", id: p.id ?? p.url, label: hostOf(p.final_url ?? p.url) || p.url };
}

const mentionType = (a: CompareAnswer): string => {
  const v = a.verdict as { mention_type?: unknown } | null | undefined;
  return v && typeof v === "object" && typeof v.mention_type === "string" ? v.mention_type : "";
};
const brandPresent = (a: CompareAnswer): boolean => {
  const v = a.verdict as { brand_present?: unknown } | null | undefined;
  return !!v && typeof v === "object" && v.brand_present === true;
};
const prominenceOf = (a: CompareAnswer): string => {
  const v = a.verdict as { prominence?: unknown } | null | undefined;
  return v && typeof v === "object" && typeof v.prominence === "string" ? v.prominence : "";
};

/** Co-appearance test for the prominence duel: the rival named alongside you in
 *  THIS answer's other_brands (not a segment steer — that isn't a shared list). */
function rivalInOtherBrands(a: CompareAnswer, isRival: (n: string) => boolean): boolean {
  for (const o of normOtherBrands(a.verdict)) if (isRival(o.name)) return true;
  return false;
}

/** every segment object on an answer's verdict (tolerant of the loose jsonb) */
function readSegments(a: CompareAnswer): { winner: string; segment: string; reason: string }[] {
  const v = a.verdict as { segments?: unknown } | null | undefined;
  const raw = v && typeof v === "object" ? v.segments : undefined;
  if (!Array.isArray(raw)) return [];
  const out: { winner: string; segment: string; reason: string }[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    out.push({
      winner: typeof r.winner === "string" ? r.winner : "",
      segment: typeof r.segment === "string" ? r.segment : "",
      reason: typeof r.reason === "string" ? r.reason : "",
    });
  }
  return out;
}

/** Does this answer name the chosen rival — in `other_brands` OR as a segment
 *  winner? (The two places a run records "the engines mentioned {rival} here".) */
function rivalInAnswer(a: CompareAnswer, isRival: (n: string) => boolean): boolean {
  for (const o of normOtherBrands(a.verdict)) if (isRival(o.name)) return true;
  for (const s of readSegments(a)) if (s.winner && isRival(s.winner)) return true;
  return false;
}

/* ============================ rival options =============================== */

/** Rivals mined from the run, ranked by mention count (SOV count, falling back
 *  to distinct absent-answer appearances), self-excluded, capped at 8. This is
 *  the segmented picker's source of truth. */
export function rivalOptions(input: CompareInput): RivalOption[] {
  const isSelf = makeMatcher([input.brand.name, ...(input.brand.aliases ?? [])]);
  const counts = new Map<string, { name: string; mentions: number }>();

  // (1) share-of-voice counts — the canonical mention tally
  for (const [name, count] of sovEntries(input.scores?.share_of_voice)) {
    if (!name.trim() || isSelf(name)) continue;
    const key = nameWords(name);
    if (!key) continue;
    counts.set(key, { name: name.trim(), mentions: count });
  }
  // (2) rivals named in absent/other_brands that never made SOV — count the
  //     distinct answers naming them so they're still pickable.
  const seenPerRival = new Map<string, Set<string>>();
  for (const a of input.answers) {
    if (a.ok === false) continue;
    for (const o of normOtherBrands(a.verdict)) {
      const name = o.name.trim();
      if (!name || isSelf(name)) continue;
      const key = nameWords(name);
      if (!key) continue;
      const seen = seenPerRival.get(key) ?? new Set<string>();
      seen.add(`${a.qid}|${a.engine}`);
      seenPerRival.set(key, seen);
      if (!counts.has(key)) counts.set(key, { name, mentions: 0 });
    }
  }
  for (const [key, seen] of seenPerRival) {
    const e = counts.get(key);
    if (e) e.mentions = Math.max(e.mentions, seen.size);
  }

  return [...counts.values()]
    .filter((r) => r.mentions > 0)
    .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name))
    .slice(0, 8);
}

/* ============================ the compare ================================= */

const MAX_GRID_ROWS = 24;
const MAX_PAGES = 8;
const MAX_STEERS = 8;

/** Compose the head-to-head against ONE rival from a single done run's rows. */
export function buildRivalCompare(input: CompareInput, rival: string): RivalCompare {
  const isRival = makeMatcher([rival]);
  const rivalKnown = rivalOptions(input).some((o) => makeMatcher([o.name])(rival));

  const snapshotNote = `One run, one snapshot: you and ${rival} are read from the same audit, so every question was asked once and scored the same way. Comparing over time takes a second run.`;

  return {
    rival,
    rivalKnown,
    grid: buildGrid(input, isRival),
    counts: buildCounts(input, rival, isRival),
    prominence: buildProminence(input, isRival),
    pagesTheyOwn: buildPages(input, isRival),
    steers: buildSteers(input, isRival),
    snapshotNote,
  };
}

/* ---- 2. head-to-head verdict grid (scored questions only) ---------------- */

function buildGrid(input: CompareInput, isRival: (n: string) => boolean): CompareGrid | null {
  const scored = input.answers.filter((a) => a.ok !== false && isScored(a.qtype ?? ""));
  if (scored.length === 0) return null;

  // one canonical answer per (qid, engine): prefer a recommended draw, then any
  // brand-present draw, then the first — so a cell reflects the strongest signal.
  const rank = (a: CompareAnswer): number =>
    mentionType(a) === "recommended" ? 2 : brandPresent(a) ? 1 : 0;
  const best = new Map<string, CompareAnswer>();
  const questionByQid = new Map<string, string>();
  const enginesSeen = new Set<string>();
  for (const a of scored) {
    enginesSeen.add(a.engine);
    if (!questionByQid.has(a.qid)) questionByQid.set(a.qid, clean(a.question ?? a.qid) || a.qid);
    const key = `${a.qid}|${a.engine}`;
    const prev = best.get(key);
    if (!prev || rank(a) > rank(prev)) best.set(key, a);
  }
  const engines = ENGINE_ORDER.filter((e) => enginesSeen.has(e));
  if (engines.length === 0) return null;

  const qids = [...questionByQid.keys()];
  const rows: CompareRow[] = qids.map((qid) => {
    let contested = false;
    const cells: CompareCell[] = engines.map((engine) => {
      const a = best.get(`${qid}|${engine}`);
      if (!a) return { engine, favor: null, recommended: false };
      const rivalHere = rivalInAnswer(a, isRival);
      const present = brandPresent(a);
      const recommended = mentionType(a) === "recommended";
      let favor: CellFavor;
      if (rivalHere && present) favor = "both";
      else if (rivalHere) favor = "rival";
      else if (present) favor = "you";
      else favor = "neither";
      if (rivalHere) contested = true;
      return { engine, favor, recommended, receipt: answerReceipt(a) };
    });
    return { qid, question: questionByQid.get(qid) ?? qid, qtype: "", contested, cells };
  });

  // contested rows first (the actual head-to-heads), then by qid for stability
  rows.sort((a, b) => Number(b.contested) - Number(a.contested) || a.qid.localeCompare(b.qid));
  const shown = rows.slice(0, MAX_GRID_ROWS);
  return { engines, rows: shown, more: Math.max(0, rows.length - shown.length) };
}

/* ---- 3. counts strip (mentions + recommended) ---------------------------- */

function buildCounts(
  input: CompareInput,
  rival: string,
  isRival: (n: string) => boolean,
): CompareCount[] | null {
  const scores = input.scores;
  if (!scores) return null;
  const entries = sovEntries(scores.share_of_voice);
  const isSelf = makeMatcher([input.brand.name, ...(input.brand.aliases ?? [])]);
  const brandSov = entries.find(([n]) => isSelf(n))?.[1] ?? scores.overall?.mentioned ?? 0;
  const rivalSov = entries.find(([n]) => isRival(n))?.[1] ?? 0;

  // representative receipts (SOV is an aggregate — link to a concrete answer):
  // yours = first answer that recommends/names you; theirs = first naming them.
  const yourAns = input.answers.find((a) => a.ok !== false && brandPresent(a));
  const rivalAns = input.answers.find((a) => a.ok !== false && rivalInAnswer(a, isRival));

  const scoredAnswered = scores.overall?.answered ?? 0;
  const recommended = scores.overall?.recommended ?? 0;
  // rival's honest "chosen instead" number: scored answers naming them while you
  // are absent (we score recommendations for YOUR brand only — stated in note).
  const scoredAbsentNamingRival = input.answers.filter(
    (a) =>
      a.ok !== false &&
      isScored(a.qtype ?? "") &&
      !brandPresent(a) &&
      rivalInAnswer(a, isRival),
  ).length;
  const firstAbsentNamingRival = input.answers.find(
    (a) => a.ok !== false && isScored(a.qtype ?? "") && !brandPresent(a) && rivalInAnswer(a, isRival),
  );

  const counts: CompareCount[] = [
    {
      metric: "Mentions across all scored answers",
      you: brandSov,
      rival: rivalSov,
      youReceipt: yourAns ? answerReceipt(yourAns) : undefined,
      rivalReceipt: rivalAns ? answerReceipt(rivalAns) : undefined,
    },
    {
      metric: "Recommended by the engines",
      you: recommended,
      rival: scoredAbsentNamingRival,
      youReceipt: yourAns ? answerReceipt(yourAns) : undefined,
      rivalReceipt: firstAbsentNamingRival ? answerReceipt(firstAbsentNamingRival) : undefined,
      note: `Of ${scoredAnswered} scored answers. We score recommendations for your brand only; for ${rival} this counts the scored answers that name them while you're absent.`,
    },
  ];
  // hide the strip only if it carries no signal at all
  return counts.some((c) => c.you > 0 || c.rival > 0) ? counts : null;
}

/* ---- 3b. prominence duel — when you BOTH appear, who leads? --------------- */

const PROMINENCE_LABEL: { key: "first" | "early" | "buried"; label: string }[] = [
  { key: "first", label: `You're named first` },
  { key: "early", label: `You're named early` },
  { key: "buried", label: `You're buried below the list` },
];

/** Across the answers where you AND the rival co-appear (other_brands), tally
 *  YOUR placement (verdict.prominence). Self-hides when there are no
 *  co-appearances; a co-appearance with no stored prominence still counts to the
 *  total but lands in no bucket (honest — we never invent a placement). */
function buildProminence(
  input: CompareInput,
  isRival: (n: string) => boolean,
): CompareProminence | null {
  const co = input.answers.filter(
    (a) => a.ok !== false && brandPresent(a) && rivalInOtherBrands(a, isRival),
  );
  if (co.length === 0) return null;

  const countOf = (key: string): number => co.filter((a) => prominenceOf(a) === key).length;
  const firstOf = (key: string): CompareAnswer | undefined =>
    co.find((a) => prominenceOf(a) === key);

  const lines: CompareProminenceLine[] = PROMINENCE_LABEL.map(({ key, label }) => {
    const rep = firstOf(key);
    return { key, label, count: countOf(key), receipt: rep ? answerReceipt(rep) : undefined };
  }).filter((l) => l.count > 0);

  return {
    coAppearances: co.length,
    namedFirst: countOf("first"),
    namedEarly: countOf("early"),
    buried: countOf("buried"),
    lines,
    leadReceipt: answerReceipt(co[0]),
  };
}

/* ---- 4. pages they own that you don't ------------------------------------ */

function buildPages(input: CompareInput, isRival: (n: string) => boolean): ComparePages | null {
  const rows = input.corpus
    .filter(
      (p) =>
        p.brand_present === false &&
        (p.competitors_present ?? []).some((c) => isRival(c)) &&
        citationDepth(p.cited_by) > 0,
    )
    .map((p) => ({
      host: clean(hostOf(p.final_url ?? p.url) || p.url),
      url: p.final_url ?? p.url,
      cited: citationDepth(p.cited_by),
      engines: pageEngineCount(p.cited_by),
      // the buyer questions this page decides — sorted, deduped, empty-safe
      decides: [...new Set((p.cited_for_qids ?? []).filter(Boolean))].sort(),
      receipt: pageReceipt(p),
    }))
    .sort((a, b) => b.cited - a.cited || b.engines - a.engines || a.host.localeCompare(b.host));
  if (rows.length === 0) return null;
  const shown = rows.slice(0, MAX_PAGES);
  return { pages: shown, more: Math.max(0, rows.length - shown.length) };
}

/* ---- 5. where they take your buyers (this rival's steers) ---------------- */

function buildSteers(input: CompareInput, isRival: (n: string) => boolean): CompareSteers | null {
  // distinct conditional steers TO this rival: dedupe by normalized segment,
  // markdown stripped for display (the stored raw stays verbatim behind the tap).
  const bySeg = new Map<string, CompareSteer>();
  for (const a of input.answers) {
    if (a.ok === false) continue;
    for (const s of readSegments(a)) {
      if (!s.winner || !isRival(s.winner)) continue;
      const segment = clean(s.segment);
      if (!segment) continue;
      const key = segment.toLowerCase();
      if (bySeg.has(key)) continue;
      bySeg.set(key, { segment, reason: quote(s.reason), receipt: answerReceipt(a) });
    }
  }
  const items = [...bySeg.values()];
  if (items.length === 0) return null;
  const shown = items.slice(0, MAX_STEERS);
  return { items: shown, more: Math.max(0, items.length - shown.length) };
}
