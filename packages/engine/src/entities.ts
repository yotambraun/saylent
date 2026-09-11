// HTML-entity decoding for TITLES. A page's <title> and an engine's citation
// title are raw HTML source, so they arrive entity-encoded — and a surprising
// number of CMSes escape an ALREADY-escaped string, so the wire value is a
// CHAIN ("&amp;amp;amp;" for one "&"). Decoding once leaves "&amp;" on the
// page, which is why titles used to render as "Ranked &amp;amp; Compared".
//
// Zero imports on purpose: this module is reachable from client components
// (re-exported by @saylent/report/entities), so it must stay pure string ops.

/** The named entities that actually occur in page titles. Anything outside this
 *  table plus the numeric forms is left alone — a title is display copy, and a
 *  literal "&foo;" beats a wrong guess. */
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  deg: "°",
  copy: "©",
  reg: "®",
  trade: "™",
  eacute: "é",
  times: "×",
};

const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

/** One decoding pass: named table + decimal/hex numeric references. */
function decodeOnce(s: string): string {
  return s.replace(ENTITY, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      // Reject NUL, surrogates and out-of-range points — keep the raw text.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      if (code >= 0xd800 && code <= 0xdfff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const hit = NAMED[body.toLowerCase()];
    return hit ?? whole;
  });
}

/** Max passes over a double-escaped chain. Five unwraps "&amp;amp;amp;amp;&amp;"
 *  and still terminates on adversarial input. */
const MAX_PASSES = 5;

/** Decode HTML entities in a title, repeatedly, until the string stops changing
 *  (bounded). Idempotent: decoding an already-decoded title is a no-op, so it is
 *  safe to apply at extraction AND again on display. */
export function decodeEntities(s: string): string {
  let out = s;
  for (let i = 0; i < MAX_PASSES; i++) {
    const next = decodeOnce(out);
    if (next === out) return out;
    out = next;
  }
  return out;
}
