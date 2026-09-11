// Pure citation-URL logic for the flattened `citations` table (migration 0032).
//
// normUrl + unwrapArchiveUrl are a zero-dependency COPY of the minimal pure logic
// from packages/engine/src/util.ts. This is a deliberate copy, not an import: that
// module pulls in cheerio (and the SSRF stack), and neither the backfill script nor
// the citations writer should drag that in. If the normalization rules in util.ts
// change, mirror them here.
//
// citationHost used to be a byte-identical copy too (see packages/engine/src/
// citation-host.ts for the history); it is now a straight re-export of the engine
// copy so the rule lives in exactly one place. Unit-tested in citation-url.test.ts.

/** src/engine/util.ts — lowercase scheme+host, strip fragment, strip tracking
 *  params (utm_*, ref, fbclid, gclid), strip trailing slash keeping the root.
 *  Returns input unchanged if unparseable. Kept identical to util.ts normUrl. */
export function normUrl(u: string): string {
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return u;
  }
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = "";
  const params = parsed.searchParams;
  for (const key of [...params.keys()]) {
    if (/^utm_/i.test(key) || ["ref", "fbclid", "gclid"].includes(key.toLowerCase())) {
      params.delete(key);
    }
  }
  let out = parsed.toString();
  if (out.endsWith("/") && parsed.pathname !== "/") out = out.slice(0, -1);
  if (parsed.pathname === "/" && !parsed.search) {
    out = `${parsed.protocol}//${parsed.host}/`;
  }
  return out;
}

// Copied from src/engine/util.ts — recover the original page URL from a Wayback
// snapshot wrapper (id_ form or bare timestamped capture).
const ARCHIVE_WRAP = /^https?:\/\/web\.archive\.org\/web\/\d+(?:id_)?\/(https?:\/\/.+)$/;

/** Unwrap a web.archive.org snapshot URL to the original; input unchanged otherwise. */
export function unwrapArchiveUrl(u: string): string {
  return ARCHIVE_WRAP.exec(u)?.[1] ?? u;
}

// citationHost (the aggregation key: real source host, www-stripped, with
// web.archive.org snapshots and Gemini vertexaisearch grounding-redirects
// unwrapped) is owned by the engine now — see packages/engine/src/citation-host.ts
// for the full derivation + the Gemini-redirect-title rule. Re-exported here so
// every existing `@saylent/report/citation-url` import keeps working unchanged.
export { citationHost } from "@saylent/engine/citation-host";
