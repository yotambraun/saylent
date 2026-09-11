// "Where rivals beat you". Over the answers the brand is
// ABSENT from, tally which rivals the engines named instead, the reasons they
// gave, the exact (qid, engine) answers to open, and the cited third-party pages
// those rivals sit on. Pure: no React/Supabase/Next. Both verdict shapes are
// handled via verdict-compat.normOtherBrands (value import → relative path;
// vitest has no path-alias config).
import { normOtherBrands } from "@saylent/engine/verdict-compat";

/** Anything verdict-shaped: a typed Verdict or a loose DB jsonb row. We read
 *  brand_present / mention_type / other_brands off it, all tolerantly. */
type VerdictLike =
  | { brand_present?: unknown; mention_type?: unknown; other_brands?: unknown }
  | null
  | undefined;

export interface RivalGapAnswer {
  qid: string;
  engine: string;
  ok?: boolean;
  verdict?: VerdictLike;
}

/** Minimal cited-page shape — a structural subset of the dossier's CorpusRow,
 *  so the view passes its DB rows and gets them back in `pages[].page`. */
export interface RivalGapPage {
  url: string;
  title?: string | null;
  page_type?: string;
  cited_by: Record<string, number>;
  competitors_present: string[];
}

export interface RivalGap<P extends RivalGapPage> {
  name: string;
  /** number of absent answers that named this rival */
  count: number;
  /** the stated reasons, deduped case-insensitively, top 2 by count (ties keep
   *  first-seen order); empty whys are dropped */
  whys: { text: string; count: number }[];
  /** distinct qids where this rival appears in an absent answer, first-seen order */
  qids: string[];
  /** (qid, engine) of each absent answer naming the rival — the receipts to open */
  refs: { qid: string; engine: string }[];
  /** top 3 cited pages featuring the rival, most-cited first; carries the row */
  pages: { page: P; citations: number }[];
}

export interface RivalGaps<P extends RivalGapPage> {
  rivals: RivalGap<P>[];
  /** how many answers the brand was absent from (the honest denominator) */
  totalAbsentAnswers: number;
}

const norm = (s: string) => s.trim().toLowerCase();
const sumCites = (c: Record<string, number>) =>
  Object.values(c).reduce((s, n) => s + (n ?? 0), 0);

function isAbsent(v: VerdictLike): boolean {
  if (!v || typeof v !== "object") return false;
  const row = v as Record<string, unknown>;
  return row.brand_present === false || row.mention_type === "absent";
}

interface Acc {
  name: string;
  count: number;
  qids: string[];
  qidSeen: Set<string>;
  refs: { qid: string; engine: string }[];
  whys: Map<string, { text: string; count: number }>;
}

export function rivalGaps<P extends RivalGapPage>(
  answers: RivalGapAnswer[],
  pages: P[],
  brand: string,
  aliases: string[] = [],
): RivalGaps<P> | null {
  const self = new Set([brand, ...aliases].map(norm));
  const acc = new Map<string, Acc>();
  let totalAbsentAnswers = 0;

  for (const a of answers) {
    if (!isAbsent(a.verdict)) continue;
    totalAbsentAnswers += 1;
    const seenInAnswer = new Set<string>();
    for (const { name, why } of normOtherBrands(a.verdict)) {
      const key = norm(name);
      if (!key || self.has(key) || seenInAnswer.has(key)) continue;
      seenInAnswer.add(key);
      let e = acc.get(key);
      if (!e) {
        e = { name: name.trim(), count: 0, qids: [], qidSeen: new Set(), refs: [], whys: new Map() };
        acc.set(key, e);
      }
      e.count += 1;
      if (!e.qidSeen.has(a.qid)) {
        e.qidSeen.add(a.qid);
        e.qids.push(a.qid);
      }
      e.refs.push({ qid: a.qid, engine: a.engine });
      const w = why.trim();
      if (w) {
        const wk = norm(w);
        const prev = e.whys.get(wk);
        if (prev) prev.count += 1;
        else e.whys.set(wk, { text: w, count: 1 });
      }
    }
  }

  const rivals = [...acc.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5)
    .map((e) => ({
      name: e.name,
      count: e.count,
      whys: [...e.whys.values()].sort((a, b) => b.count - a.count).slice(0, 2),
      qids: e.qids,
      refs: e.refs,
      pages: pagesForRival(e.name, pages),
    }));

  return rivals.length > 0 ? { rivals, totalAbsentAnswers } : null;
}

function pagesForRival<P extends RivalGapPage>(name: string, pages: P[]): { page: P; citations: number }[] {
  const key = norm(name);
  return pages
    .map((page) => ({ page, citations: sumCites(page.cited_by) }))
    .filter((x) => x.citations > 0 && x.page.competitors_present.some((c) => norm(c) === key))
    .sort((a, b) => b.citations - a.citations || a.page.url.localeCompare(b.page.url))
    .slice(0, 3);
}
