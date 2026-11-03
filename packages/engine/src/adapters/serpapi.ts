// SerpApi, the first SERP-data provider (BYO key: SERPAPI_API_KEY).
// Verified 2026-11-02 against SerpApi's public docs:
//   Google AI Overview  https://serpapi.com/ai-overview (inline vs page_token),
//                       https://serpapi.com/google-ai-overview-api
//   Google AI Mode      https://serpapi.com/google-ai-mode-api
//   Bing Copilot        https://serpapi.com/bing-copilot-api
//   Errors              https://serpapi.com/api-status-and-error-codes
//
// Every call is GET https://serpapi.com/search?engine=...&api_key=... and
// returns JSON. Shapes this adapter reads (and nothing else):
//   engine=google              ai_overview: { text_blocks, references } inline,
//                              OR { page_token, serpapi_link } (token expires in
//                              about a minute: fetch it immediately), OR
//                              { error: "..." }, OR no ai_overview key at all
//                              (Google showed none for the query)
//   engine=google_ai_overview  page_token=... → the same text_blocks/references
//   engine=google_ai_mode      top-level text_blocks, references, and a
//                              reconstructed_markdown string
//   engine=bing_copilot        top-level header, text_blocks, references
//   errors                     HTTP 400/401/403/404/410/429/5xx with {"error": "..."};
//                              429 = hourly throughput cap OR out of searches
// Locale: gl (two-letter country), hl (language, e.g. en, en-gb, es-419) and
// location (city level) on the two Google engines; Copilot documents none.
import type { SurfaceLocale } from "../surfaces";
import type { SurfaceId } from "../types";
import { type AnswerBlock, type AnswerReference, type SerpProvider, answerFromBlocks, notShown } from "./serp";
import { type AskResult, failed, withRetry } from "./shared";

export const SERPAPI_ENDPOINT = "https://serpapi.com/search";

interface SerpApiAnswer {
  text_blocks?: AnswerBlock[];
  references?: AnswerReference[];
  reconstructed_markdown?: string;
  header?: string;
  error?: string;
}

interface SerpApiResponse extends SerpApiAnswer {
  search_metadata?: { status?: string };
  ai_overview?: SerpApiAnswer & { page_token?: string; serpapi_link?: string };
}

class SerpApiHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** SerpApi's `hl` takes lowercase language codes with an optional region
 *  ("en", "en-gb", "es-419"); a BCP47 tag like "pt-BR" maps onto that. */
export function serpApiLanguage(tag: string): string {
  return tag.trim().toLowerCase();
}

/** The query string for one request. api_key goes LAST so nothing else
 *  follows it in a URL that might be echoed into an error (the shared
 *  redaction covers `api_key=` anyway). */
export function serpApiParams(
  engine: string,
  args: Record<string, string | undefined>,
  locale: SurfaceLocale | undefined,
  honorsLocale: boolean,
  apiKey: string,
): URLSearchParams {
  const p = new URLSearchParams({ engine });
  for (const [k, v] of Object.entries(args)) if (v) p.set(k, v);
  if (honorsLocale && locale) {
    if (locale.country) p.set("gl", locale.country.toLowerCase());
    if (locale.language) p.set("hl", serpApiLanguage(locale.language));
    if (locale.location) p.set("location", locale.location);
  }
  p.set("output", "json");
  p.set("api_key", apiKey);
  return p;
}

async function getJson(
  params: URLSearchParams,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<SerpApiResponse> {
  return withRetry(async () => {
    const r = await fetchImpl(`${SERPAPI_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) {
      let detail = "";
      try {
        const body = (await r.json()) as { error?: unknown };
        detail = typeof body?.error === "string" ? body.error : "";
      } catch {
        /* non-JSON error body */
      }
      const hint =
        r.status === 429 ? " (hourly throughput limit reached, or the account is out of searches)" : "";
      throw new SerpApiHttpError(r.status, `serpapi ${r.status}${hint}: ${detail.slice(0, 200)}`);
    }
    return (await r.json()) as SerpApiResponse;
  });
}

const blocksOf = (a: SerpApiAnswer | undefined): AnswerBlock[] =>
  Array.isArray(a?.text_blocks) ? a.text_blocks : [];
const refsOf = (a: SerpApiAnswer | undefined): AnswerReference[] =>
  Array.isArray(a?.references) ? a.references : [];

/** A 200 whose body still carries a top-level error (SerpApi reports e.g.
 *  "Google hasn't returned any results for this query." this way). */
function bodyError(data: SerpApiResponse): string | null {
  return typeof data.error === "string" && data.error ? data.error : null;
}

const LOCALE_NOTE = (l: SurfaceLocale | undefined) =>
  [l?.country && `gl=${l.country}`, l?.language && `hl=${serpApiLanguage(l.language)}`, l?.location && `location=${l.location}`]
    .filter(Boolean)
    .join(", ") || "provider default locale";

export const serpApiProvider: SerpProvider = {
  id: "serpapi",
  serves: ["google_ai_overview", "google_ai_mode", "copilot"],
  async fetch(surface: SurfaceId, question, ctx): Promise<AskResult> {
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const timeoutMs = ctx.timeoutMs ?? 60_000;
    try {
      if (surface === "google_ai_overview") {
        const first = await getJson(
          serpApiParams("google", { q: question }, ctx.locale, true, ctx.apiKey),
          fetchImpl,
          timeoutMs,
        );
        const err = bodyError(first);
        if (err && !first.ai_overview) return notShown("Google AI Overviews", 1, err.slice(0, 160));
        const aio = first.ai_overview;
        if (!aio) return notShown("Google AI Overviews", 1, `no AI Overview on this results page; ${LOCALE_NOTE(ctx.locale)}`);
        if (typeof aio.error === "string" && aio.error && blocksOf(aio).length === 0) {
          return notShown("Google AI Overviews", 1, aio.error.slice(0, 160));
        }
        if (blocksOf(aio).length > 0) return answerFromBlocks(blocksOf(aio), refsOf(aio), 1);
        if (typeof aio.page_token === "string" && aio.page_token) {
          // The token expires within about a minute: fetch it now, no queueing.
          const second = await getJson(
            serpApiParams("google_ai_overview", { page_token: aio.page_token }, undefined, false, ctx.apiKey),
            fetchImpl,
            timeoutMs,
          );
          const answer: SerpApiAnswer = second.ai_overview ?? second;
          if (blocksOf(answer).length === 0) {
            const why = (typeof answer.error === "string" && answer.error) || bodyError(second) || "the overview came back empty";
            return notShown("Google AI Overviews", 2, why.slice(0, 160));
          }
          return answerFromBlocks(blocksOf(answer), refsOf(answer), 2);
        }
        return notShown("Google AI Overviews", 1, "the AI Overview block had no content");
      }

      if (surface === "google_ai_mode") {
        const data = await getJson(
          serpApiParams("google_ai_mode", { q: question }, ctx.locale, true, ctx.apiKey),
          fetchImpl,
          timeoutMs,
        );
        if (blocksOf(data).length === 0 && !data.reconstructed_markdown) {
          return notShown("Google AI Mode", 1, (bodyError(data) ?? "no answer blocks in the response").slice(0, 160));
        }
        return answerFromBlocks(blocksOf(data), refsOf(data), 1, { fallbackText: data.reconstructed_markdown });
      }

      // copilot (bing_copilot): no documented locale parameters.
      const data = await getJson(serpApiParams("bing_copilot", { q: question }, ctx.locale, false, ctx.apiKey), fetchImpl, timeoutMs);
      if (blocksOf(data).length === 0 && !data.header) {
        return notShown("Microsoft Copilot", 1, (bodyError(data) ?? "no answer blocks in the response").slice(0, 160));
      }
      return answerFromBlocks(blocksOf(data), refsOf(data), 1, { header: data.header });
    } catch (e) {
      return failed(e);
    }
  },
};
