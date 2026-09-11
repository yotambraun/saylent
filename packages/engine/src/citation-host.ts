// Implements the citation host-derivation the flattened `citations` projection
// needs (migration 0032). It lives in the engine because runAudit() builds that
// projection inside the judge step and the engine may not import the report
// package. `packages/report/src/citation-url.ts` holds the older standalone copy
// (written when the engine still pulled in cheerio through util.ts); the rules
// here are byte-identical and the report copy should re-export this one when the
// report package is next touched.
import { unwrapArchiveUrl } from "./util";

// Gemini grounding cites a vertexaisearch redirect whose real destination host is
// NOT in the URL; Gemini fills the citation *title* with the source domain, so for
// an unresolved redirect that title is the only signal of the true host.
const VERTEX_REDIRECT_HOST = "vertexaisearch.cloud.google.com";
// A bare hostname like "g2.com" / "hostafrica.co.za" (no scheme, no path).
const BARE_HOST = /^([a-z0-9-]+\.)+[a-z]{2,}$/i;

/** The aggregation key for a citation: its real source host, www-stripped, with
 *  web.archive.org snapshots and Gemini vertexaisearch grounding-redirects
 *  unwrapped. Returns "" when nothing parseable is available. */
export function citationHost(url: string, title?: string | null): string {
  let host: string;
  try {
    host = new URL(unwrapArchiveUrl(url)).hostname.toLowerCase();
  } catch {
    host = "";
  }
  if (host === VERTEX_REDIRECT_HOST && title) {
    const t = title.trim().toLowerCase().replace(/^www\./, "");
    if (BARE_HOST.test(t)) return t;
  }
  return host.replace(/^www\./, "");
}
