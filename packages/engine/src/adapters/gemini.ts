// the spec (see METHODOLOGY.md) gemini.ts — @google/genai generateContent + googleSearch tool.
// ⚠ VERIFIED GOTCHA (see METHODOLOGY.md): groundingChunks[].web.uri values are
// vertexaisearch.cloud.google.com REDIRECT links. We resolve them to their real
// destination (resolveRedirectCitations) BEFORE returning, so the saved answer
// row — and the dossier receipt drawer that renders it — shows the real page,
// not the opaque redirect. The corpus step still re-resolves + aggregates on
// final_url. A response with no groundingMetadata = model chose not to search:
// valid answer, citations=[].
import { GoogleGenAI } from "@google/genai";
import { resolveRedirectCitations } from "../resolve-redirects";
import type { Citation } from "../types";
import { type Ask, MAX_OUTPUT_TOKENS, failed, keyMissing, withRetry } from "./shared";

export const askGemini: Ask = async (question, { model, apiKey }) => {
  if (!apiKey) return keyMissing();
  try {
    const ai = new GoogleGenAI({ apiKey });
    // F2 — bounded retry (429/5xx only) wraps ONLY the network call.
    const res = await withRetry(() =>
      ai.models.generateContent({
        model,
        contents: question,
        config: {
          tools: [{ googleSearch: {} }],
          maxOutputTokens: MAX_OUTPUT_TOKENS + 600, // headroom: thinking tokens count too
        },
      }),
    );

    const text = res.text ?? "";
    const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const citations: Citation[] = [];
    for (const ch of chunks) {
      if (ch.web?.uri) citations.push({ url: ch.web.uri, title: ch.web.title ?? undefined });
    }
    const um = res.usageMetadata;
    return {
      ok: true,
      text,
      // resolve vertexaisearch redirects + dedupe before the row is persisted
      citations: await resolveRedirectCitations(citations),
      usage: {
        input_tokens: um?.promptTokenCount,
        output_tokens: (um?.candidatesTokenCount ?? 0) + (um?.thoughtsTokenCount ?? 0),
        searches: res.candidates?.[0]?.groundingMetadata?.webSearchQueries?.length ?? 0,
      },
    };
  } catch (e) {
    return failed(e);
  }
};
