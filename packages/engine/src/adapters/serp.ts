// The SERP-provider seam behind every answer SURFACE (surfaces.ts).
//
// A SerpProvider fetches one surface's answer for one question and hands back
// the SAME AskResult an engine adapter returns: the answer text, its citations
// in the order the answer uses them, and the provider requests it spent (as
// usage.searches, which rates.ts prices per request). Everything downstream
// (judge, score, sources, report) cannot tell a surface answer from an engine
// answer, which is the point.
//
// A second provider is a small addition: implement SerpProvider (one fetch per
// surface it serves, mapping its own response into the shared AnswerBlock
// shape), register it in SERP_PROVIDER_IMPLS, add its metadata to
// surfaces.ts SERP_PROVIDERS and its request price to rates.ts.
//
// "Not shown" is a first-class result, not an error and not an absence: Google
// shows an AI Overview for some queries only. A provider returns notShown() for
// that case; the answer row is ok:false with a "no_answer:" error (so it is a
// coverage gap the score never counts and the judge never reads) but it still
// carries usage, because the search itself was billed.
import type { SerpProviderId, SurfaceLocale } from "../surfaces";
import type { Citation, SurfaceId } from "../types";
import type { AskResult } from "./shared";
import { dedupeCitations } from "./shared";

export interface SerpFetchContext {
  apiKey: string;
  locale?: SurfaceLocale;
  /** injectable for tests (recorded fixtures); defaults to global fetch */
  fetchImpl?: typeof fetch;
  /** per-request timeout (default 60s) */
  timeoutMs?: number;
}

export interface SerpProvider {
  id: SerpProviderId;
  /** the surfaces this provider implements */
  serves: readonly SurfaceId[];
  fetch(surface: SurfaceId, question: string, ctx: SerpFetchContext): Promise<AskResult>;
}

// ---------------------------------------------------------------------------
// The shared answer-block shape. SerpApi's AI Overview, AI Mode and Copilot
// responses all use it (text_blocks + references); a provider with a different
// shape maps into it before calling renderAnswerBlocks.
// ---------------------------------------------------------------------------

export interface AnswerBlock {
  type?: string;
  snippet?: string;
  title?: string;
  /** heading level, when the provider gives one (Copilot) */
  level?: number;
  /** nested list items (type "list") */
  list?: AnswerBlock[];
  /** nested blocks some providers use for expandable sections */
  text_blocks?: AnswerBlock[];
  /** table rows, when present */
  table?: unknown[];
  /** code blocks */
  code?: string;
  /** indexes into the references array, in the order this block cites them */
  reference_indexes?: number[];
}

export interface AnswerReference {
  index?: number;
  title?: string;
  link?: string;
  url?: string;
  snippet?: string;
  source?: string;
}

const clean = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

function tableLines(rows: unknown[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (Array.isArray(row)) out.push(`| ${row.map((c) => clean(c)).join(" | ")} |`);
    else if (row && typeof row === "object") out.push(`| ${Object.values(row).map((c) => clean(c)).join(" | ")} |`);
  }
  return out;
}

/** Render text blocks as plain markdown (paragraph → line, heading → "##",
 *  list → "- " items, nested lists indented) and collect every reference index
 *  in first-use order. Unknown block types keep their snippet, so a provider
 *  adding a new block type degrades to text, never to silence. */
export function renderAnswerBlocks(blocks: readonly AnswerBlock[]): { text: string; order: number[] } {
  const lines: string[] = [];
  const order: number[] = [];
  const seen = new Set<number>();
  const cite = (idx: number[] | undefined) => {
    for (const i of idx ?? []) {
      if (typeof i === "number" && !seen.has(i)) {
        seen.add(i);
        order.push(i);
      }
    }
  };
  const walk = (items: readonly AnswerBlock[], depth: number) => {
    for (const b of items) {
      if (!b || typeof b !== "object") continue;
      const type = (b.type ?? "paragraph").toLowerCase();
      const title = clean(b.title);
      const snippet = clean(b.snippet);
      const indent = "  ".repeat(Math.max(0, depth - 1));
      cite(b.reference_indexes);
      if (type === "heading") {
        if (snippet || title) lines.push(`${"#".repeat(Math.min(4, Math.max(2, (b.level ?? 1) + 1)))} ${snippet || title}`);
      } else if (type === "list" || Array.isArray(b.list)) {
        if (snippet) lines.push(snippet);
        for (const item of b.list ?? []) {
          if (!item || typeof item !== "object") continue;
          cite(item.reference_indexes);
          const head = clean(item.title);
          const body = clean(item.snippet);
          const line = head && body ? `${head} ${body}` : head || body;
          if (line) lines.push(`${indent}- ${line}`);
          if (Array.isArray(item.list) && item.list.length) walk([{ type: "list", list: item.list }], depth + 1);
          if (Array.isArray(item.text_blocks) && item.text_blocks.length) walk(item.text_blocks, depth + 1);
        }
      } else if (type === "table" && Array.isArray(b.table)) {
        if (snippet) lines.push(snippet);
        lines.push(...tableLines(b.table));
      } else if (type === "code_block" || type === "code") {
        const code = typeof b.code === "string" ? b.code : snippet;
        if (code) lines.push("```", code, "```");
      } else {
        const line = title && snippet ? `${title} ${snippet}` : snippet || title;
        if (line) lines.push(`${indent}${line}`);
      }
      if (Array.isArray(b.text_blocks) && b.text_blocks.length && type !== "list") walk(b.text_blocks, depth + 1);
    }
  };
  walk(blocks, 1);
  return { text: lines.join("\n\n").replace(/\n\n(\s*- )/g, "\n$1").trim(), order };
}

/** Citations in the order the answer uses them: every reference a block cites,
 *  first use first, then any reference the answer lists but no block points at
 *  (in the provider's own index order). Deduped by normalized URL. */
export function orderedCitations(references: readonly AnswerReference[], order: readonly number[]): Citation[] {
  const byIndex = new Map<number, AnswerReference>();
  references.forEach((r, i) => byIndex.set(typeof r.index === "number" ? r.index : i, r));
  const picked: AnswerReference[] = [];
  const used = new Set<AnswerReference>();
  for (const i of order) {
    const r = byIndex.get(i);
    if (r && !used.has(r)) {
      used.add(r);
      picked.push(r);
    }
  }
  for (const r of references) if (!used.has(r)) picked.push(r);
  const out: Citation[] = [];
  for (const r of picked) {
    const url = clean(r.link) || clean(r.url);
    if (!/^https?:\/\//i.test(url)) continue;
    const title = clean(r.title) || clean(r.source);
    out.push({ url, ...(title ? { title } : {}) });
  }
  return dedupeCitations(out);
}

/** Build the AskResult for an answer made of blocks + references. */
export function answerFromBlocks(
  blocks: readonly AnswerBlock[],
  references: readonly AnswerReference[],
  requests: number,
  opts: { header?: string; fallbackText?: string } = {},
): AskResult {
  const { text, order } = renderAnswerBlocks(blocks);
  const body = text || clean(opts.fallbackText);
  const header = clean(opts.header);
  const full = header && body && !body.startsWith(header) ? `${header}\n\n${body}` : body || header;
  return {
    ok: true,
    text: full,
    citations: orderedCitations(references, order),
    usage: { searches: requests },
  };
}

/** The honest "this surface showed no answer for this question" result. */
export function notShown(surfaceLabel: string, requests: number, why: string): AskResult {
  return {
    ok: false,
    text: "",
    citations: [],
    error: `no_answer: ${surfaceLabel} showed no answer for this question (${why})`,
    usage: { searches: requests },
  };
}

/** true for a row the surface legitimately did not answer (see notShown). */
export { isNotShownRow as isNotShown } from "../surfaces";
