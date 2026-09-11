// THE ONE PREVIEW PIPELINE (doctrine: this bug class must be impossible, not
// patched). Stored engine text — verdict excerpts, claims, segments, reasons,
// page excerpts, pricing claims — carries markdown (`**bold**`, `[4]` citations,
// `code`) and is frequently PRE-CUT mid-word at store time (judge excerpts and
// captured page text are stored already-truncated). Every DISPLAY/PREVIEW/panel
// string in the report (Brief cards, /vs, dossier intel panels) flows through
// this module and nowhere else.
//
// RULE OF LAW: RECEIPTS stay VERBATIM. The stored raw_text shown in the drawers
// is the real thing and is never touched here. Only the PREVIEW/panel context —
// the derived, in-card copy — is cleaned. `preview-invariants.test.ts` is the $0
// CI probe that walks every composer's output and enforces this class.

import { decodeEntities } from "./entities";

/** Strip display markdown from a preview/excerpt: paired + orphan emphasis
 *  (`**bold**`, `*em*`, and the UNPAIRED `**`/`*` a mid-word cut leaves behind),
 *  ATX headings, `[n]` / `[n][m]` citation brackets, inline `code`, and runs of
 *  2+ whitespace. Idempotent. Stored raw_text stays verbatim — this is preview
 *  copy only, never a receipt. */
export function stripMarkdownForPreview(t: string): string {
  return t
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, "$1$2")
    // orphan emphasis markers: a truncated excerpt ("…uses the **mid…") leaves
    // an UNPAIRED ** / * behind that the pair-rules above can't catch. Previews
    // must never show a literal asterisk run.
    .replace(/\*{1,3}/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[(\d+)\](\[(\d+)\])*/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s{2,}/g, " ");
}

/** The tail heuristic: a preview built from a stored string that was CUT mid-word
 *  upstream ends inside a word ("…uses the mid…"). We fold a SHORT (≤12-char)
 *  final token that sits before a trailing ellipsis back into the "…" so the
 *  preview never ends inside a fragment, and normalize an ASCII "..." tail to the
 *  single "…" glyph. Deliberately NOT idempotent — each pass peels one fragment;
 *  callers apply it once at the final visible tail. */
const foldTail = (s: string): string =>
  s.replace(/\s+\S{1,12}(…|\.{3})$/, "…").replace(/\.{3}$/, "…");

/** Edge-tidy for a stored excerpt we wrap in ellipses on BOTH ends: captured page
 *  text is often pre-cut mid-word at each edge. Drop at most one partial token per
 *  edge so the wrapped preview reads clean and never mid-word — the surrounding
 *  "…" already signal continuation. Does NOT strip markdown (the page-excerpt
 *  receipt below stays verbatim); pair with `stripMarkdownForPreview` via
 *  `previewText({ edges: true })` when the source also carries markdown. */
export function trimEdgeFragments(t: string): string {
  let s = t.trim();
  // leading fragment: a lowercase start means we landed mid-sentence — drop the
  // (possibly partial) first token; the lead "…" already signals continuation
  if (/^[a-z0-9]/.test(s)) s = s.replace(/^\S+\s+/, "");
  // trailing fragment: no sentence-final punctuation means a probable mid-word
  // cut — drop the last token; the tail "…" already signals continuation
  if (!/[.!?»”"']$/.test(s)) s = s.replace(/\s+\S+$/, "");
  return s;
}

/** Display tidy for a QUOTED preview that may have been CUT mid-word upstream.
 *  Strips markdown, trims, then folds a trailing cut fragment. Kept as a named
 *  export for existing call sites — equivalent to `previewText(t, { tail: true })`
 *  but without the internal whitespace-collapse (preserved as-is). Receipts stay
 *  verbatim; this is for panel/drawer PREVIEW lines only. */
export function tidyPreviewQuote(t: string): string {
  return foldTail(stripMarkdownForPreview(t ?? "").trim());
}

export interface PreviewOpts {
  /** fold a trailing mid-word cut fragment + normalize an ASCII "..." tail to "…"
   *  (the `tidyPreviewQuote` heuristic). Use for verbatim engine EXCERPTS/quotes
   *  that may be stored pre-truncated. */
  tail?: boolean;
  /** drop at most one partial token at EACH edge, for an excerpt rendered wrapped
   *  in leading + trailing ellipses (`trimEdgeFragments`). */
  edges?: boolean;
}

/** THE canonical preview entry — every display/preview string in the report goes
 *  through here. Pipeline: strip markdown → collapse whitespace → trim → optional
 *  edge-tidy → optional tail-tidy. Default (no opts) is the safe, IDEMPOTENT
 *  cleaner used for names, labels, teasers and plain prose. `{ tail: true }` for
 *  quoted engine excerpts that may be pre-cut; `{ edges: true }` for a doubly
 *  ellipsized page excerpt. Doctrine: CSS truncates for width; JS never cuts for
 *  width — this only heals markdown + upstream mid-word cuts. Receipts (raw_text)
 *  are never passed here; they stay verbatim. */
export function previewText(t: string, opts: PreviewOpts = {}): string {
  // Entity decoding belongs to THIS pipeline for the same reason markdown
  // stripping does: a page title stored as "Ranked &amp;amp; Compared" must
  // never reach a card. Idempotent, so it is also applied at extraction.
  let s = decodeEntities(stripMarkdownForPreview(t ?? ""))
    .replace(/\s+/g, " ")
    .trim();
  if (opts.edges) s = trimEdgeFragments(s).trim();
  if (opts.tail) s = foldTail(s);
  return s;
}

/** Code-point-safe cap on preview length: `String.prototype.slice` counts
 *  UTF-16 code UNITS, so a fixed-length cut can land inside a surrogate pair
 *  (an emoji or other astral character) and leave a lone, unpaired surrogate
 *  behind — invisible in a terminal, but non-deterministic on serialization
 *  (a lone surrogate has no valid UTF-8 encoding, so what it becomes depends
 *  on the encoder, not the source string). Real engine excerpts carry emoji;
 *  every fixed-length preview cut MUST go through this instead of `.slice`. */
export function sliceCodePoints(s: string, maxCodePoints: number): string {
  let count = 0;
  let end = 0;
  for (const ch of s) {
    if (count >= maxCodePoints) break;
    end += ch.length; // 1 for a BMP char, 2 for a surrogate-pair code point
    count++;
  }
  return s.slice(0, end);
}
