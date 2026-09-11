// SPIKE (branch spike-pulse-win): the real "answer diff" behind The Pulse.
// Given the SAME frozen question+engine across two runs, compute which whole
// SENTENCES the engine ADDED or REMOVED between baseline and current — never a
// score. Pure module (no Next/Supabase); reuses wordPresent from the engine so
// brand-alias detection is identical to the audit's own whole-word rule.
//
// Design choices (kept deliberately pragmatic for a spike, but honest):
//  - Split line-by-line first so bullets / headings are natural boundaries,
//    then split within a line on . ! ? that are real sentence enders (not
//    decimals like "3.5", not abbreviations like "e.g.", not en-dash ranges
//    like "2025–2026" which contain no period at all).
//  - Compare on a NORMALIZED form (markdown emphasis stripped, links unwrapped,
//    whitespace collapsed, lowercased) so "**Acme** is fast." and
//    "Acme is fast." are the SAME sentence — formatting noise is not a change.
//  - Rank surfaced sentences: brand-mentioning first, then longer first
//    (more substantive), capped at 3 added + 3 removed per answer.
// @saylent/engine is a real workspace package (node_modules symlink +
// source-level `exports`), so a VALUE import through it resolves at test
// runtime same as any other import — no relative-path workaround needed
// (open-source split, 2026-09-09; see source-map.ts).
import { wordPresent } from "@saylent/engine/util";

export interface DiffSentence {
  /** original text (markdown intact) — what we show the customer */
  text: string;
  mentionsBrand: boolean;
}

export interface AnswerDiff {
  qid: string;
  engine: string;
  question: string;
  added: DiffSentence[];
  removed: DiffSentence[];
  /** true when any added OR removed sentence names the audited brand */
  brandTouched: boolean;
}

/** Minimal shape the diff needs from a persisted answer row. */
export interface DiffAnswerInput {
  qid: string;
  engine: string;
  question: string;
  raw_text: string;
}

const CAP = 3;

// Common abbreviations whose trailing period must NOT end a sentence.
const ABBREV = new Set([
  "e.g",
  "i.e",
  "etc",
  "vs",
  "al",
  "no",
  "fig",
  "inc",
  "ltd",
  "co",
  "mr",
  "ms",
  "mrs",
  "dr",
  "u.s",
  "u.k",
  "a.k.a",
  "approx",
  "est",
]);

const lastWordBefore = (s: string): string => {
  const m = /([A-Za-z][A-Za-z.]*)\s*$/.exec(s);
  return m ? m[1].replace(/\.$/, "") : "";
};

/** Split one already-trimmed line into sentences on real terminal punctuation. */
function splitLine(line: string): string[] {
  const res: string[] = [];
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    // absorb runs like "?!" or "..."
    let j = i;
    while (j + 1 < line.length && ".!?".includes(line[j + 1])) j++;
    const before = line[i - 1];
    const afterRaw = line[j + 1];
    // decimal / version number: 3.5, v2.1 — digit on both sides of a '.'
    if (ch === "." && /\d/.test(before ?? "") && /\d/.test(afterRaw ?? "")) {
      i = j;
      continue;
    }
    // abbreviation ending in this period
    if (ch === "." && ABBREV.has(lastWordBefore(line.slice(start, i + 1)).toLowerCase())) {
      i = j;
      continue;
    }
    if (afterRaw === undefined) {
      res.push(line.slice(start).trim());
      start = line.length;
      i = j;
      continue;
    }
    if (!/\s/.test(afterRaw)) continue; // "foo.bar" mid-token — not a boundary
    // first non-space char after the terminator
    let k = j + 1;
    while (k < line.length && /\s/.test(line[k])) k++;
    const nc = line[k];
    // boundary if the next chunk starts a new sentence-ish token
    if (nc === undefined || /[A-Z0-9"'“([*_`•]/.test(nc)) {
      res.push(line.slice(start, j + 1).trim());
      start = k;
      i = k - 1;
    }
  }
  if (start < line.length) {
    const tail = line.slice(start).trim();
    if (tail) res.push(tail);
  }
  return res.filter(Boolean);
}

/** Split a full answer into display sentences (original text preserved). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of (text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // drop leading list markers / heading hashes / blockquote arrows for a clean
    // sentence, but keep the substantive text
    const cleaned = line.replace(/^(?:[-*+•>#]+\s+|\d+[.)]\s+)/, "").trim();
    if (!cleaned) continue;
    for (const s of splitLine(cleaned)) out.push(s);
  }
  return out;
}

/** Normalized comparison key: markdown/emphasis/link noise removed, collapsed,
 * lowercased. Two sentences that differ only in formatting share a key. */
export function normalizeForCompare(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [text](url) → text
    .replace(/[*_`~]+/g, "") // emphasis / code / strikethrough markers
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function mentions(text: string, aliases: string[]): boolean {
  return aliases.some((a) => a && wordPresent(a, text));
}

/** brand-mentioning first, then longer first; unique by normalized key; cap. */
function rank(list: { display: string; norm: string }[], aliases: string[]): DiffSentence[] {
  const seen = new Set<string>();
  const uniq: { text: string; mentionsBrand: boolean }[] = [];
  for (const s of list) {
    if (seen.has(s.norm)) continue;
    seen.add(s.norm);
    uniq.push({ text: s.display, mentionsBrand: mentions(s.display, aliases) });
  }
  uniq.sort((a, b) => {
    if (a.mentionsBrand !== b.mentionsBrand) return a.mentionsBrand ? -1 : 1;
    return b.text.length - a.text.length;
  });
  return uniq.slice(0, CAP);
}

/** Diff a single (qid, engine) pair across two runs. */
export function diffAnswer(
  baseline: DiffAnswerInput,
  current: DiffAnswerInput,
  aliases: string[],
): AnswerDiff {
  const toKeyed = (t: string) =>
    splitSentences(t)
      .map((display) => ({ display, norm: normalizeForCompare(display) }))
      .filter((s) => s.norm.length > 0);

  const base = toKeyed(baseline.raw_text);
  const curr = toKeyed(current.raw_text);
  const baseNorms = new Set(base.map((s) => s.norm));
  const currNorms = new Set(curr.map((s) => s.norm));

  const added = rank(
    curr.filter((s) => !baseNorms.has(s.norm)),
    aliases,
  );
  const removed = rank(
    base.filter((s) => !currNorms.has(s.norm)),
    aliases,
  );

  return {
    qid: current.qid,
    engine: current.engine,
    question: current.question || baseline.question,
    added,
    removed,
    brandTouched:
      added.some((s) => s.mentionsBrand) || removed.some((s) => s.mentionsBrand),
  };
}

/** Pair baseline↔current answers by (qid, engine); return only pairs with a
 * non-empty diff, brand-touching ones first (that's what The Pulse leads with). */
export function diffRuns(
  baselineAnswers: DiffAnswerInput[],
  currentAnswers: DiffAnswerInput[],
  aliases: string[],
): AnswerDiff[] {
  const key = (a: { qid: string; engine: string }) => `${a.engine}:${a.qid}`;
  const baseMap = new Map(baselineAnswers.map((a) => [key(a), a]));
  const diffs: AnswerDiff[] = [];
  for (const cur of currentAnswers) {
    const base = baseMap.get(key(cur));
    if (!base) continue; // no counterpart in the baseline run — nothing to diff
    const d = diffAnswer(base, cur, aliases);
    if (d.added.length === 0 && d.removed.length === 0) continue;
    diffs.push(d);
  }
  diffs.sort((a, b) => (a.brandTouched === b.brandTouched ? 0 : a.brandTouched ? -1 : 1));
  return diffs;
}
