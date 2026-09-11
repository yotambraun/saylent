// the spec (see METHODOLOGY.md) chatgpt.ts — OpenAI Responses API, tool {type:"web_search"}
// (verified current; web_search_preview is legacy — do not use). Output array
// parsed BY TYPE, never by position (reasoning models insert extra items).
import OpenAI from "openai";
import type { Citation } from "../types";
import { type Ask, MAX_OUTPUT_TOKENS, dedupeCitations, failed, keyMissing, withRetry } from "./shared";

export const askChatgpt: Ask = async (question, { model, apiKey }) => {
  if (!apiKey) return keyMissing();
  try {
    const client = new OpenAI({ apiKey });
    // F2 — bounded retry (429/5xx only, 2 retries, jittered backoff) wraps
    // ONLY the network call; parsing/success path below is unchanged.
    const res = await withRetry(() =>
      client.responses.create({
        model,
        input: question,
        tools: [{ type: "web_search" }],
        // E8 receipt: uncapped, the model ran ~5 searches/answer (1¢ + ~5K input
        // tokens EACH). 3 bounds cost while rarely truncating (provider guidance).
        // (documented API param; this SDK version's create-params type lags — cast)
        max_tool_calls: 3,
        // reasoning tokens are billed as output AND consume the cap — keep effort
        // low and give headroom so the visible answer never gets truncated
        reasoning: { effort: "low" },
        max_output_tokens: MAX_OUTPUT_TOKENS + 900,
      } as OpenAI.Responses.ResponseCreateParamsNonStreaming),
    );

    let text = "";
    let searches = 0;
    const citations: Citation[] = [];
    for (const item of res.output ?? []) {
      // count only true searches (billed) — open_page/find actions are not searches
      // (confirmed against provider billing on a real run).
      if (
        item.type === "web_search_call" &&
        ((item as unknown as { action?: { type?: string } }).action?.type ?? "search") === "search"
      ) {
        searches++;
      }
      if (item.type !== "message") continue; // BY TYPE — skip reasoning etc.
      for (const part of item.content ?? []) {
        if (part.type !== "output_text") continue;
        text += part.text;
        for (const ann of part.annotations ?? []) {
          if (ann.type === "url_citation") {
            citations.push({ url: ann.url, title: ann.title });
          }
        }
      }
    }
    return {
      ok: true,
      text,
      citations: dedupeCitations(citations),
      usage: {
        input_tokens: res.usage?.input_tokens,
        output_tokens: res.usage?.output_tokens,
        searches,
      },
    };
  } catch (e) {
    return failed(e);
  }
};
