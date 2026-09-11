// the spec (see METHODOLOGY.md) claude.ts — Anthropic messages + web_search_20250305 tool
// (verified still supported). Text = text blocks; citations = text blocks'
// citations[] urls + web_search_tool_result content urls. Encrypted result
// blobs are never parsed (see METHODOLOGY.md).
import Anthropic from "@anthropic-ai/sdk";
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
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [{ role: "user", content: question }],
        tools: [
          {
            // MEASURED: a provider-side "dynamic filtering" change once DOUBLED billed input
            // (486K vs 232K tokens per 6 answers) for our short single-question
            // case — the filtering pipeline itself bills the raw results. Reverted
            // to the basic tool with a tight cap.
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
    };
  } catch (e) {
    return failed(e);
  }
};
