// the spec (see METHODOLOGY.md) claude.ts — Anthropic messages + web_search_20250305 tool
// (still the documented basic version on Sonnet 5.5, checked 2026-11-02). Text = text blocks; citations = text blocks'
// citations[] urls + web_search_tool_result content urls. Encrypted result
// blobs are never parsed (see METHODOLOGY.md).
import Anthropic from "@anthropic-ai/sdk";
import { claudeSearchQueries } from "../search-queries";
import type { Citation } from "../types";
import { type Ask, MAX_OUTPUT_TOKENS, dedupeCitations, failed, keyMissing, withRetry } from "./shared";

export const askClaude: Ask = async (question, cfg) => {
  const { model, apiKey } = cfg;
  if (!apiKey) return keyMissing();
  try {
    const client = new Anthropic({ apiKey });
    // F2 — bounded retry (429/5xx only) wraps ONLY the network call.
    const res = await withRetry(() =>
      client.messages.create({
        model,
        // Current Claude models think adaptively by default and thinking counts
        // against max_tokens, so the visible answer gets the same headroom the
        // chatgpt adapter gives reasoning tokens, at the same "low" effort.
        max_tokens: MAX_OUTPUT_TOKENS + 900,
        output_config: { effort: "low" },
        messages: [{ role: "user", content: question }],
        tools: [
          {
            // DELIBERATE (re-checked 2026-11-02): the dynamic-filtering versions
            // (web_search_20260209 and later) once DOUBLED billed input (486K vs
            // 232K tokens per 6 answers) for our short single-question case, because
            // the filtering pipeline itself bills the raw results. Kept on the basic
            // tool with a tight cap; searches are $10 per 1,000 either way.
            type: "web_search_20250305",
            name: "web_search",
            max_uses: cfg.maxSearches ?? 2,
          } as Anthropic.Messages.ToolUnion,
        ],
      }),
    );

    let text = "";
    const citations: Citation[] = [];
    for (const block of res.content ?? []) {
      if (block.type === "text") {
        text += block.text;
        for (const c of block.citations ?? []) {
          if ("url" in c && c.url) citations.push({ url: c.url, title: c.title ?? undefined });
        }
      } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const item of block.content) {
          if (item.type === "web_search_result" && item.url) {
            citations.push({ url: item.url, title: item.title ?? undefined });
          }
        }
      }
    }
    const serverToolUse = (res.usage as { server_tool_use?: { web_search_requests?: number } })
      ?.server_tool_use;
    return {
      ok: true,
      text,
      citations: dedupeCitations(citations),
      usage: {
        input_tokens: res.usage?.input_tokens,
        output_tokens: res.usage?.output_tokens,
        searches: serverToolUse?.web_search_requests ?? 0,
      },
      // server_tool_use web_search inputs from the same response (no extra request)
      search_queries: claudeSearchQueries(res.content ?? []),
    };
  } catch (e) {
    return failed(e);
  }
};
