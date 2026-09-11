// crawlSite (see METHODOLOGY.md): homepage + prioritized internal links,
// ≤ maxPages total (25 full / 8 smoke via caller), 200ms politeness delay,
// dedupe by normUrl. Homepage failure does NOT throw — return what we have.
//
// EXTRACT-AT-SOURCE (after a job-state size blowup on a large site): every fact downstream needs (JSON-LD
// types, meta robots directives, links) is parsed here from the FULL document
// while it is in memory, then the raw HTML is dropped. Pages therefore cost
// ~40KB each through job state instead of up to several MB, and nothing is
// position-dependent (a JSON-LD block at the very end of a 3MB page is seen).
import * as cheerio from "cheerio";
import type { SitePage } from "./types";
import { archiveSnapshotUrl, normUrl, safeFetch, stripHtmlToText } from "./util";

const PRIORITY =
  /pricing|product|features|compare|vs|blog|docs|about|customers|solutions|use-case/i;
const MAX_LINKS = 500;

// Crawler v2 (TODO "Crawler v2") — sitemap discovery caps: never parse more than
// this many total URLs across the sitemap tree, and follow at most this many child
// sitemaps of an index (one level deep). safeFetch already caps each body at ~2MB.
const MAX_SITEMAP_URLS = 500;
const MAX_CHILD_SITEMAPS = 10;

// Crawler v2 — thin/SPA classification thresholds (see classifyThin).
const THIN_WORD_MIN = 120;

// Crawler v2 (TODO "Crawler v2") — CONSERVATIVE ISO-639-1 language codes we skip
// as non-English locale path prefixes. Explicit allow/deny list on purpose: a
// broad 2-letter regex would wrongly skip /go/, /ai/, /vs/. English (en / en-*)
// is always kept.
const SKIP_LOCALES = new Set([
  "es", "de", "fr", "pt", "ja", "zh", "ko", "it", "nl", "ru", "pl", "tr", "ar", "sv",
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Crawler v2 — true when a candidate path's FIRST segment is a non-English
 *  locale prefix (`/es/…`, `/pt-br/…`). Only matches an exact `xx` or `xx-yy`
 *  segment whose language is in SKIP_LOCALES, so `/go/`, `/ai/`, `/vs/` and any
 *  real English content path (`/en/`, `/en-us/`) are NEVER skipped. */
export function isNonEnglishLocalePath(pathname: string): boolean {
  const seg = pathname.split("/").filter(Boolean)[0];
  if (!seg) return false;
  const m = /^([a-z]{2})(?:-[a-z]{2})?$/.exec(seg.toLowerCase());
  if (!m) return false; // not a bare 2-letter / xx-yy locale segment
  return m[1] !== "en" && SKIP_LOCALES.has(m[1]);
}

/** Crawler v2 — decode the handful of XML entities that appear in sitemap <loc>. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'");
}

/** Normalize a raw date string (sitemap
 *  <lastmod>, meta content, <time datetime>, JSON-LD date, or Last-Modified
 *  header) to an ISO-8601 UTC string, or null when it is not a confident date.
 *  CONSERVATIVE by design (project rule: null beats guessing): the string must
 *  carry a plausible 4-digit year, parse cleanly, and land inside a sane window
 *  (1990 .. next year). Pure + unit-tested; shared by crawl + corpus. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (!/(?:^|[^\d])(?:19|20)\d{2}(?:[^\d]|$)/.test(s)) return null; // must look date-ish
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  if (y < 1990 || y > new Date().getUTCFullYear() + 1) return null; // sanity window
  return d.toISOString();
}

/** Crawler v2 — parse a sitemap or sitemap-index document with a tiny string
 *  parser (no XML dependency). Returns the locations, whether the document is an
 *  index (its <loc>s point at CHILD sitemaps, not pages), and the parsed
 *  <lastmod> per loc (null when absent/unparseable). Caps the number
 *  of extracted entries at MAX_SITEMAP_URLS. */
export function parseSitemapLocs(xml: string): {
  locs: string[];
  isIndex: boolean;
  lastmods: (string | null)[];
} {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const locs: string[] = [];
  const lastmods: (string | null)[] = [];
  // Prefer per-entry parsing so a <loc> is paired with its own <lastmod>. Falls
  // back to a bare <loc> scan for non-wrapped documents (no lastmods available).
  const entryRe = /<(?:url|sitemap)\b[^>]*>([\s\S]*?)<\/(?:url|sitemap)>/gi;
  let em: RegExpExecArray | null;
  let matchedEntry = false;
  while ((em = entryRe.exec(xml)) && locs.length < MAX_SITEMAP_URLS) {
    matchedEntry = true;
    const locM = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/i.exec(em[1]);
    if (!locM) continue;
    locs.push(decodeXmlEntities(locM[1].trim()));
    const lmM = /<lastmod>\s*([^<\s][^<]*?)\s*<\/lastmod>/i.exec(em[1]);
    lastmods.push(lmM ? parseDate(decodeXmlEntities(lmM[1].trim())) : null);
  }
  if (!matchedEntry) {
    const re = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) && locs.length < MAX_SITEMAP_URLS) {
      locs.push(decodeXmlEntities(m[1].trim()));
      lastmods.push(null);
    }
  }
  return { locs, isIndex, lastmods };
}

// The two crawl-issue markers relayed through
// crawlSite's EXISTING onProgress parameter (see packages/cli/src/progress.ts
// parseCrawlIssueLabel, the consumer). Exported so the CLI never hardcodes
// the tag text twice.
export const CRAWL_BLOCKED_MARKER = "⚠ blocked:";
export const CRAWL_THIN_MARKER = "⚠ thin-site:";

const WAF_MARKERS =
  /cloudflare|attention required|cf-browser-verification|just a moment|access denied|request blocked|captcha|are you a (human|robot)|akamai|perimeterx|incapsula|sucuri/i;

/** Crawler v2 (F3) — a 403/429/503 on the HOME page is either a normal
 *  "that page doesn't exist" 404 (never flagged) or a bot-block: a WAF/CDN
 *  challenge page (Cloudflare, Akamai, PerimeterX, a captcha) or a bare
 *  refusal with no challenge markup. Pure, unit-tested; the caller decides
 *  what to do with it (crawlSite relays it via onProgress; see the markers
 *  above). */
export function classifyBlocked(status: number, html: string): { blocked: boolean; reason?: string } {
  if (status !== 403 && status !== 429 && status !== 503) return { blocked: false };
  const challenge = WAF_MARKERS.test(html);
  return {
    blocked: true,
    reason: challenge
      ? `${status} — looks like a bot-block/WAF challenge page`
      : `${status} — the site refused this request`,
  };
}

/** Crawler v2 (F3) — true when the crawl found mostly nothing readable: the
 *  home page is thin, or at least 60% of the crawled pages are (classifyThin
 *  already distinguishes a JS-shell/script-heavy page from a genuinely short
 *  static one). Pure, unit-tested. */
export function classifySiteThin(pages: { thin?: boolean }[]): boolean {
  if (pages.length === 0) return false;
  if (pages[0]?.thin) return true;
  const thinCount = pages.filter((p) => p.thin).length;
  return thinCount / pages.length >= 0.6;
}

/** Crawler v2 (F3) — the www/apex sibling of a host ("www.acme.com" ↔
 *  "acme.com"). Only a bare two-label host gets a "www." sibling (never a
 *  subdomain like "docs.acme.com" or an IP literal); null when there is
 *  none. Pure, unit-tested. */
export function wwwApexSibling(host: string): string | null {
  const h = host.toLowerCase();
  if (h.startsWith("www.")) return h.slice(4) || null;
  return h.split(".").length === 2 ? `www.${h}` : null;
}

/** Crawler v2 — thin/SPA page: extracted text under THIN_WORD_MIN words WHILE the
 *  raw HTML is a JS shell (empty React/Vue/Angular mount root) or script-heavy
 *  (>50% of the bytes are inside <script> tags). Genuinely small STATIC pages
 *  (short about page, no scripts) are NOT thin — the flag is about JS-rendered
 *  content answer engines can't see, so we only raise it on shell signals. */
export function classifyThin(rawHtml: string, text: string): boolean {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  if (words >= THIN_WORD_MIN) return false;
  if (!rawHtml) return false;
  const emptyRoot =
    /<(?:div|main)[^>]*\bid=["'](?:root|app|__next|__nuxt|q-app|gatsby-focus-wrapper)["'][^>]*>\s*<\/(?:div|main)>/i.test(
      rawHtml,
    );
  const scriptChars = (rawHtml.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ?? []).reduce(
    (n, s) => n + s.length,
    0,
  );
  const scriptHeavy = scriptChars / rawHtml.length > 0.5;
  return emptyRoot || scriptHeavy;
}

/** SUBPATH HOSTING — resolve the audited subject into
 *  the three things a crawl needs: the ORIGIN (where robots.txt lives, per the
 *  robots standard: always the host root), the site ROOT (origin + optional
 *  subpath, no trailing slash) and the path PREFIX the crawl must stay inside.
 *
 *  Bare-domain behaviour is unchanged: "example.com", "https://example.com" and
 *  "https://example.com/" all yield base "https://example.com" with prefix "/",
 *  so every URL the crawler builds is byte-identical to before. A path now
 *  survives ("user.github.io/saylent-kestrel"), and an explicitly typed http://
 *  is honoured instead of being silently upgraded to https. */
export function parseSiteRoot(domain: string): {
  origin: string;
  base: string;
  prefix: string;
} {
  const raw = String(domain ?? "").trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    // unparseable: fall back to the old bare-host derivation, never throw
    const host = raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    return { origin: `https://${host}`, base: `https://${host}`, prefix: "/" };
  }
  const path = u.pathname.replace(/\/+$/, "");
  return { origin: u.origin, base: `${u.origin}${path}`, prefix: path ? `${path}/` : "/" };
}

/** Crawler v2 — discover same-host page URLs from robots.txt `Sitemap:` directives
 *  and `/sitemap.xml`, following a sitemap INDEX one level deep. Uses the injected
 *  SSRF-guarded fetcher (never raw fetch). Best-effort: any failure yields []. */
export async function discoverSitemapUrls(
  base: string,
  internalHosts: Set<string>,
  fetcher: typeof safeFetch,
  // page_date: optional out-param — when provided, filled with
  // normUrl(page) → ISO <lastmod> for every discovered URL that carried a
  // confident date. Backward-compatible: the return value is unchanged (string[]).
  lastmodOut?: Map<string, string>,
  // Subpath hosting: robots.txt always lives at the HOST ROOT (robotsBase), while
  // sitemap.xml is looked for at the SITE root, and `within` keeps a subpath crawl
  // inside its own prefix. Both default to the bare-domain behaviour.
  opts: { robotsBase?: string; within?: (u: URL) => boolean } = {},
): Promise<string[]> {
  const { robotsBase = base, within = () => true } = opts;
  const roots = new Set<string>([`${base}/sitemap.xml`]);
  const robots = await fetcher(`${robotsBase}/robots.txt`).catch(() => null);
  if (robots && robots.status >= 200 && robots.status < 400 && robots.text) {
    for (const line of robots.text.split(/\r?\n/)) {
      const mm = /^\s*sitemap:\s*(\S+)/i.exec(line);
      if (!mm) continue;
      try {
        const u = new URL(mm[1], base);
        if (internalHosts.has(u.hostname) && within(u)) roots.add(u.toString());
      } catch {
        /* ignore malformed Sitemap directive */
      }
    }
  }

  const out: string[] = [];
  let childBudget = MAX_CHILD_SITEMAPS;
  const seenSitemaps = new Set<string>();
  const addLoc = (loc: string, lastmod: string | null) => {
    if (out.length >= MAX_SITEMAP_URLS) return;
    try {
      const u = new URL(loc, base);
      if (internalHosts.has(u.hostname) && within(u)) {
        const abs = u.toString();
        out.push(abs);
        if (lastmod && lastmodOut) lastmodOut.set(normUrl(abs), lastmod);
      }
    } catch {
      /* ignore malformed <loc> */
    }
  };

  for (const root of roots) {
    if (out.length >= MAX_SITEMAP_URLS) break;
    if (seenSitemaps.has(root)) continue;
    seenSitemaps.add(root);
    const res = await fetcher(root).catch(() => null);
    if (!res || res.status < 200 || res.status >= 400 || !res.text) continue;
    const { locs, isIndex, lastmods } = parseSitemapLocs(res.text);
    if (isIndex) {
      // one level deep only: fetch child sitemaps (same host), collect their page locs
      for (const child of locs) {
        if (childBudget <= 0 || out.length >= MAX_SITEMAP_URLS) break;
        let childUrl: string;
        try {
          const cu = new URL(child, base);
          if (!internalHosts.has(cu.hostname) || !within(cu)) continue;
          childUrl = cu.toString();
        } catch {
          continue;
        }
        if (seenSitemaps.has(childUrl)) continue;
        seenSitemaps.add(childUrl);
        childBudget--;
        const cres = await fetcher(childUrl).catch(() => null);
        if (!cres || cres.status < 200 || cres.status >= 400 || !cres.text) continue;
        // a child of an index is treated as a URL sitemap (ignore nested indexes)
        const cparsed = parseSitemapLocs(cres.text);
        cparsed.locs.forEach((loc, i) => addLoc(loc, cparsed.lastmods[i] ?? null));
      }
    } else {
      locs.forEach((loc, i) => addLoc(loc, lastmods[i] ?? null));
    }
  }
  return out;
}

/** all @type values (lowercased) in every JSON-LD block of the document */
export function extractLdTypes($: cheerio.CheerioAPI): string[] {
  const types = new Set<string>();
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const collect = (node: unknown) => {
        if (Array.isArray(node)) return node.forEach(collect);
        if (node && typeof node === "object") {
          const t = (node as Record<string, unknown>)["@type"];
          if (typeof t === "string") types.add(t.toLowerCase());
          if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.add(x.toLowerCase()));
          Object.values(node).forEach(collect);
        }
      };
      collect(JSON.parse($(el).text()));
    } catch {
      /* invalid JSON-LD ignored */
    }
  });
  return [...types];
}

// page_date: own-site SitePage gains an OPTIONAL date — the page's
// sitemap <lastmod> when the crawler discovered it via the sitemap. Typed as a
// local intersection (SitePage lives in the shared types module and is owned
// separately); every downstream SitePage[] consumer stays valid.
type SitePageWithDate = SitePage & { date?: string };

export async function crawlSite(
  domain: string,
  maxPages = 25,
  onProgress?: (path: string, count: number) => Promise<void>,
  opts: { fetcher?: typeof safeFetch } = {},
): Promise<SitePageWithDate[]> {
  // Injectable SSRF-guarded fetcher (default safeFetch) — mirrors buildCorpus, so
  // tests exercise sitemap discovery / thin classification without the network.
  const { fetcher = safeFetch } = opts;
  // Subpath hosting: base is the SITE root (may carry a path), origin is the host
  // root (robots.txt), prefix is the path the crawl stays inside ("/" for a host).
  const { origin, base, prefix } = parseSiteRoot(domain);
  /** true when a candidate URL is inside the audited site root's path prefix.
   *  Always true for a bare domain, so bare-domain crawls are unchanged. */
  const withinRoot = (u: URL): boolean =>
    prefix === "/" || u.pathname === prefix.slice(0, -1) || u.pathname.startsWith(prefix);
  const pages: SitePageWithDate[] = [];
  const seen = new Set<string>();
  let archiveMode = false;
  // normUrl(page) → ISO sitemap <lastmod>, filled by discovery below
  // and read when a discovered page's SitePage is built (own-site date signal).
  const sitemapDates = new Map<string, string>();

  const fetchPage = async (url: string, isHome = false): Promise<SitePageWithDate | null> => {
    const key = normUrl(url);
    if (seen.has(key)) return null;
    seen.add(key);
    let res = await fetcher(url);
    // F3 — a blocked home page is the clearest, earliest signal something is
    // wrong; relay it once via the existing onProgress channel before the
    // archive-fallback / null-return paths below run (those still apply
    // unchanged — this is purely an additional notification).
    if (isHome) {
      const block = classifyBlocked(res.status, res.text);
      if (block.blocked) {
        try {
          await onProgress?.(`${CRAWL_BLOCKED_MARKER} ${block.reason}`, 0);
        } catch {
          /* progress is cosmetic — never fail a crawl over it */
        }
      }
    }
    if (archiveMode || [401, 403, 429].includes(res.status)) {
      const snap = await archiveSnapshotUrl(url, fetcher);
      if (!snap) return null;
      const ares = await fetcher(snap, { timeoutMs: 30000 });
      if (ares.status !== 200 || !ares.text) return null;
      archiveMode = true;
      res = { status: 200, finalUrl: url, text: ares.text };
    }
    if (res.status === 0 || res.status >= 400 || !res.text) return null;
    // dedupe by FINAL url too — two links redirecting to the same page must
    // not produce duplicate rows (seen on a real site: the same docs page linked via two paths)
    const finalKey = normUrl(res.finalUrl);
    if (finalKey !== key) {
      if (seen.has(finalKey)) return null;
      seen.add(finalKey);
    }
    const $ = cheerio.load(res.text);

    const links: string[] = [];
    $("a[href]").each((_, el) => {
      if (links.length >= MAX_LINKS) return;
      const href = $(el).attr("href");
      if (!href) return;
      try {
        const abs = new URL(href, res.finalUrl || url);
        abs.hash = "";
        links.push(abs.toString());
      } catch {
        /* ignore bad hrefs */
      }
    });

    const text = stripHtmlToText(res.text);
    // Attach the sitemap <lastmod> for this own-site page when we
    // discovered it via the sitemap (check both the requested and the final URL).
    const date = sitemapDates.get(normUrl(url)) ?? sitemapDates.get(normUrl(res.finalUrl));
    return {
      url: res.finalUrl,
      status: res.status,
      title: $("title").first().text().trim(),
      text,
      ldTypes: extractLdTypes($),
      metaRobots: $('meta[name="robots"], meta[name="googlebot"]')
        .map((_, el) => $(el).attr("content") ?? "")
        .get()
        .join(",")
        .toLowerCase(),
      links,
      ...(archiveMode ? { archived: true } : {}),
      ...(classifyThin(res.text, text) ? { thin: true } : {}),
      ...(date ? { date } : {}),
    };
  };

  // A subpath root must be requested WITH its trailing slash (that is the page a
  // static host serves); a bare host keeps the exact previous string.
  const home = await fetchPage(prefix === "/" ? base : `${base}/`, true);
  if (home) pages.push(home);

  // Internal-link test must accept the REDIRECTED host too (e.g. www.example.com)
  // or www-canonical sites lose their absolute links (2026-07-03 crawler review).
  const internalHosts = new Set([new URL(base).hostname]);
  if (home) {
    try {
      internalHosts.add(new URL(home.url).hostname);
    } catch {
      /* keep typed host only */
    }
  }
  // F3 — www/apex normalization: "www.acme.com" and "acme.com" crawl the
  // same root even when the site never redirects between them (both serve
  // 200 independently) — a link to either variant is still internal, so
  // nothing in that other host's link graph is wrongly treated as external
  // and skipped. The CANONICAL host (what the report shows) stays whichever
  // one `home.url` resolved to above — unchanged when the two never diverge.
  const sibling = wwwApexSibling(new URL(base).hostname);
  if (sibling) internalHosts.add(sibling);

  // Crawler v2 — sitemap.xml / robots Sitemap discovery, merged into the candidate
  // pool BEFORE the PRIORITY ordering below. Best-effort: never blocks the crawl.
  let sitemapUrls: string[] = [];
  try {
    sitemapUrls = await discoverSitemapUrls(base, internalHosts, fetcher, sitemapDates, {
      robotsBase: origin,
      within: withinRoot,
    });
  } catch {
    /* sitemap discovery is additive — a failure never fails the crawl */
  }

  const candidates: string[] = [];
  const candidateKeys = new Set<string>(); // dedupe the merged pool by normUrl
  for (const link of [...(home?.links ?? []), ...sitemapUrls]) {
    try {
      const abs = new URL(link);
      if (!internalHosts.has(abs.hostname)) continue;
      if (!withinRoot(abs)) continue; // subpath hosting: never leave the site root
      if (/\.(pdf|png|jpg|jpeg|gif|svg|zip|mp4|webp|ico|css|js|xml)(\?|$)/i.test(abs.pathname))
        continue;
      // locale check runs on the path RELATIVE to the site root (a subpath's first
      // segment is the project, not a locale)
      const relPath = prefix === "/" ? abs.pathname : abs.pathname.slice(prefix.length - 1);
      if (isNonEnglishLocalePath(relPath)) continue; // Crawler v2 — skip non-English locales
      const key = normUrl(abs.toString());
      if (candidateKeys.has(key)) continue;
      candidateKeys.add(key);
      candidates.push(abs.toString());
    } catch {
      /* ignore */
    }
  }

  // prioritized first, then the rest, deduped by normUrl
  const ordered = [
    ...candidates.filter((u) => PRIORITY.test(u)),
    ...candidates.filter((u) => !PRIORITY.test(u)),
  ];

  for (const url of ordered) {
    if (pages.length >= maxPages) break;
    if (seen.has(normUrl(url))) continue;
    await sleep(200); // politeness delay (see METHODOLOGY.md)
    const page = await fetchPage(url);
    if (page) {
      pages.push(page);
      try {
        await onProgress?.(new URL(page.url).pathname, pages.length);
      } catch {
        /* progress is cosmetic — never fail a crawl over it */
      }
    }
  }
  // F3 — thin/JS-shell site: relay once, after the crawl has enough pages to
  // judge honestly (classifySiteThin), through the same onProgress channel.
  if (classifySiteThin(pages)) {
    try {
      await onProgress?.(`${CRAWL_THIN_MARKER} mostly JS-rendered — answer engines may see very little of this site`, pages.length);
    } catch {
      /* progress is cosmetic — never fail a crawl over it */
    }
  }
  return pages;
}
