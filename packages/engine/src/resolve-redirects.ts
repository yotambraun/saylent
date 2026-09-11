// Implements the the spec (see METHODOLOGY.md) Gemini gotcha fix. Gemini grounding cites
// `candidates[0].groundingMetadata.groundingChunks[].web.uri`, but that uri is a
// `vertexaisearch.cloud.google.com/grounding-api-redirect/...` REDIRECT — "the
// real page URL only appears after following it" (see METHODOLOGY.md). The corpus step
// (see METHODOLOGY.md) already resolves these into final_url via safeFetch so the
// battlefield merges Gemini pages with other engines'. This shared util applies
// the SAME safeFetch redirect-following to an answer's citations BEFORE the
// answer row is saved, so the dossier receipt drawer shows the real destination
// instead of an opaque redirect. It REUSES safeFetch (util.ts) — no duplicated
// redirect logic — and only touches vertexaisearch redirects; every other
// citation passes through untouched. Any fetch failure keeps the original
// redirect url (a failed resolve is NEVER an answer failure; never drop a cite).
import type { Citation } from "./types";
import { dedupeCitations } from "./adapters/shared";
import { safeFetch } from "./util";

const VERTEX_REDIRECT_HOST = "vertexaisearch.cloud.google.com";

/** the spec (see METHODOLOGY.md) — is this one of Gemini's vertexaisearch redirect links? */
export function isVertexRedirect(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === VERTEX_REDIRECT_HOST && u.pathname.includes("/grounding-api-redirect/");
  } catch {
    return false;
  }
}

/** Follow ONE vertexaisearch redirect to its real destination using the same
 *  safeFetch the corpus uses (≤3 hops, guardrails, timeout). Non-redirects and
 *  any failure return the input unchanged — never throws, never drops. */
async function resolveOne(url: string, fetcher: typeof safeFetch, timeoutMs: number): Promise<string> {
  if (!isVertexRedirect(url)) return url;
  try {
    const res = await fetcher(url, { timeoutMs });
    // status 0 = network/guard fail. A finalUrl still on the redirect host means
    // the hop chain never left vertexaisearch (e.g. a 200 JS/meta redirect page)
    // — keep the original so we never surface a redirect stub as "resolved".
    if (res.status === 0 || !res.finalUrl || isVertexRedirect(res.finalUrl)) return url;
    return res.finalUrl;
  } catch {
    return url;
  }
}

/** Resolve a citation list's vertexaisearch redirects (concurrency-capped) then
 *  re-dedupe by normUrl (two redirects can resolve to one page). Title behavior
 *  is unchanged: the resolver only follows redirects, so each citation keeps the
 *  title Gemini reported (typically the destination's domain) — we add no page
 *  fetch just for titles. Non-Gemini citation lists resolve to a no-op (the
 *  vertex check short-circuits) and are simply re-deduped. */
export async function resolveRedirectCitations(
  citations: Citation[],
  opts: { concurrency?: number; timeoutMs?: number; fetcher?: typeof safeFetch } = {},
): Promise<Citation[]> {
  const { concurrency = 5, timeoutMs = 10000, fetcher = safeFetch } = opts;
  const resolved: Citation[] = new Array(citations.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, citations.length) }, async () => {
    while (next < citations.length) {
      const i = next++;
      const c = citations[i];
      const url = await resolveOne(c.url, fetcher, timeoutMs);
      resolved[i] = { url, ...(c.title ? { title: c.title } : {}) };
    }
  });
  await Promise.all(lanes);
  // re-dedupe on the resolved urls (shared with the adapters' normUrl dedupe)
  return dedupeCitations(resolved);
}
