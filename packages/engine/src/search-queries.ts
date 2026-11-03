// Query fan-out as receipts: the web searches an answer engine ran before it
// answered, read from fields its API already returns (no extra request, no
// extra cost). Pure and client-safe.
//
// WHERE EACH ENGINE REPORTS THEM (checked against the providers' API docs,
// 2026-11-02):
//   chatgpt  Responses API output items `type: "web_search_call"` whose
//            `action.type` is "search": `action.queries` (string[]), or the
//            older `action.query` (string, marked deprecated). The docs say a
//            search action "will usually (but not always)" carry its queries.
//   claude   Messages API content blocks `type: "server_tool_use"`,
//            `name: "web_search"`, `input.query`; kept only when the matching
//            `web_search_tool_result` is a result list, not an error object.
//   gemini   generateContent `candidates[0].groundingMetadata.webSearchQueries`
//            (string[]).
//   perplexity  The Sonar chat completions response carries `search_results`
//            and `citations` but no query strings: not exposed.
//   google_ai_overview, google_ai_mode, copilot  Read through SerpApi, which
//            returns the answer shown for the question itself: not exposed.
//
// STORED SHAPE: `search_queries` on an answer (and on each sample) is the list
// for that draw, `[]` when the engine reports them and ran none, and absent or
// null when the engine does not report them or the run predates 0.2.0.
import type { Engine } from "./types";

const MAX_QUERIES = 20;
const MAX_QUERY_CHARS = 300;

/** The engines whose API reports the search queries it ran. */
export const SEARCH_QUERY_ENGINES: readonly Engine[] = ["chatgpt", "claude", "gemini"];

export function exposesSearchQueries(engine: string): boolean {
  return (SEARCH_QUERY_ENGINES as readonly string[]).includes(engine);
}

/** Strings only, trimmed, no empties, no exact repeats, in the order the
 *  engine ran them; at most 20, each at most 300 characters. */
export function cleanSearchQueries(raw: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const q of raw) {
    if (typeof q !== "string") continue;
    const t = q.trim().slice(0, MAX_QUERY_CHARS);
    if (!t || out.includes(t)) continue;
    out.push(t);
    if (out.length === MAX_QUERIES) break;
  }
  return out;
}

type Loose = Record<string, unknown>;
const asObj = (v: unknown): Loose | null => (v && typeof v === "object" ? (v as Loose) : null);

/** OpenAI Responses API `output` -> the queries of its search actions. */
export function openaiSearchQueries(output: readonly unknown[]): string[] {
  const raw: unknown[] = [];
  for (const item of output) {
    const it = asObj(item);
    if (it?.type !== "web_search_call" || it.status === "failed") continue;
    const action = asObj(it.action);
    if (!action || (action.type ?? "search") !== "search") continue;
    if (Array.isArray(action.queries)) raw.push(...action.queries);
    else if (typeof action.query === "string") raw.push(action.query);
  }
  return cleanSearchQueries(raw);
}

/** Anthropic Messages API `content` -> the web_search queries that ran. */
export function claudeSearchQueries(content: readonly unknown[]): string[] {
  const ran = new Set<string>();
  for (const block of content) {
    const b = asObj(block);
    if (b?.type === "web_search_tool_result" && Array.isArray(b.content) && typeof b.tool_use_id === "string") {
      ran.add(b.tool_use_id);
    }
  }
  const raw: unknown[] = [];
  for (const block of content) {
    const b = asObj(block);
    if (b?.type !== "server_tool_use" || b.name !== "web_search" || typeof b.id !== "string" || !ran.has(b.id)) continue;
    raw.push(asObj(b.input)?.query);
  }
  return cleanSearchQueries(raw);
}

/** Gemini generateContent response -> groundingMetadata.webSearchQueries. */
export function geminiSearchQueries(res: { candidates?: readonly unknown[] }): string[] {
  const meta = asObj(asObj(res.candidates?.[0])?.groundingMetadata);
  return cleanSearchQueries(Array.isArray(meta?.webSearchQueries) ? meta.webSearchQueries : []);
}

export type SearchQueriesState =
  | { kind: "listed"; queries: string[] }
  /** the engine reports its searches and ran none */
  | { kind: "none" }
  /** the engine searched (billed searches > 0) but its response named no query */
  | { kind: "unreported"; searches: number }
  /** this engine's API does not report its searches */
  | { kind: "not_exposed" }
  /** the engine reports them, but this answer was stored without them (older run) */
  | { kind: "not_recorded" };

/** What a report can honestly say about one answer's searches. */
export function searchQueriesState(a: {
  engine: string;
  search_queries?: readonly string[] | null;
  usage?: { searches?: number } | null;
}): SearchQueriesState {
  if (!exposesSearchQueries(a.engine)) return { kind: "not_exposed" };
  if (!Array.isArray(a.search_queries)) return { kind: "not_recorded" };
  if (a.search_queries.length > 0) return { kind: "listed", queries: [...a.search_queries] };
  const searches = a.usage?.searches ?? 0;
  return searches > 0 ? { kind: "unreported", searches } : { kind: "none" };
}
