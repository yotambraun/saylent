// the spec (see METHODOLOGY.md) perplexity.ts — OpenAI-compatible POST to
// https://api.perplexity.ai/chat/completions. Citations = top-level
// citations[] (plain URL strings) merged with search_results[].{url,title},
// deduped by normUrl (both fields verified present in current responses).
import type { Citation } from "../types";
import { type Ask, MAX_OUTPUT_TOKENS, dedupeCitations, failed, keyMissing, withRetry } from "./shared";

interface PerplexityResponse {
  choices?: { message?: { content?: string } }[];
  citations?: string[];
  search_results?: { url?: string; title?: string; date?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: { total_cost?: number };
  };
}

export const askPerplexity: Ask = async (question, { model, apiKey }) => {
  if (!apiKey) return keyMissing();
  try {
    // F2 — bounded retry (429/5xx only) wraps the fetch + the ok-check, so a
    // 429/503 thrown here is classified and retried exactly like the SDK
    // adapters; any other non-ok status rethrows immediately (not retryable).
    const res = await withRetry(async () => {
      const r = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: question }],
          max_tokens: MAX_OUTPUT_TOKENS,
        }),
        signal: AbortSignal.timeout(120000),
      });
      if (!r.ok) {
        const err = new Error(`perplexity ${r.status}: ${(await r.text()).slice(0, 200)}`) as Error & {
          status?: number;
        };
        err.status = r.status;
        throw err;
      }
      return r;
    });
    const data = (await res.json()) as PerplexityResponse;
    const text = data.choices?.[0]?.message?.content ?? "";
    const citations: Citation[] = [
      ...(data.citations ?? []).map((url) => ({ url })),
      ...(data.search_results ?? [])
        .filter((r): r is { url: string; title?: string } => !!r.url)
        .map((r) => ({ url: r.url, title: r.title })),
    ];
    return {
      ok: true,
      text,
      citations: dedupeCitations(citations),
      usage: {
        input_tokens: data.usage?.prompt_tokens,
        output_tokens: data.usage?.completion_tokens,
        searches: 1, // per-request search fee model
      },
    };
  } catch (e) {
    return failed(e);
  }
};
