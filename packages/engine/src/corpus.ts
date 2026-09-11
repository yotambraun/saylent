// The spec (see METHODOLOGY.md) — aggregate citations across ALL answers into
// {normUrl → cited_by/cited_for_qids/title}, take top N by total citations,
// fetch each (100ms spacing, concurrency ≤8), classify, deterministic
// brand/competitor presence; fetch failure ⇒ brand_present=null ("unverified",
// NEVER guess). Battlefield rows merge on normalized final_url so Gemini's
// redirect links land on the same page rows as other engines (see METHODOLOGY.md).
import { classifyPage } from "./classify";
import { classifyThin, parseDate } from "./crawl";
import { decodeEntities } from "./entities";
import { pool } from "./observe";
import type { AnswerRow, BrandModel, CorpusPageRow, DbWriter, Engine } from "./types";
import {
  archiveSnapshotUrl,
  contextExcerpt,
  normUrl,
  safeFetch,
  stripHtmlToText,
  unwrapArchiveUrl,
  wordPresent,
} from "./util";

interface Agg {
  url: string;
  title?: string;
  cited_by: Partial<Record<Engine, number>>;
  cited_for_qids: Set<string>;
}

// Outlet contact signals scraped from a cited page so an
// outreach fix can say HOW to reach the outlet, not just which one. Persisted to
// corpus_pages.contact (migration 0035). Every field optional; null row when none.
export interface ContactSignals {
  mailto?: string;
  form_url?: string;
  claim_url?: string;
}

// Enrichment fields buildCorpus attaches to each CorpusPageRow.
// page_date + contact are PERSISTED (migration 0035 columns, written by
// db.saveCorpusPage). word_count + section_count are TRANSIENT depth measurements
// (no DB column — like Fix.drafterHints): they ride the in-run corpus array into
// diagnose() so a fix can name the winning page's depth, and the resulting evidence
// STRING is what gets persisted with the fix. On a replay from stored rows they are
// absent (undefined) — the depth line then honestly does not appear.
export interface CorpusEnrichment {
  page_date?: string | null;
  contact?: ContactSignals | null;
  word_count?: number;
  section_count?: number;
}

export type EnrichedCorpusPageRow = CorpusPageRow & CorpusEnrichment;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** page_date — first CONFIDENT own-date signal in the page, in the
 *  spec's priority order: article:published_time → article:modified_time →
 *  <time datetime> → JSON-LD datePublished → JSON-LD dateModified → Last-Modified
 *  header. Returns an ISO string or null (null beats guessing). `lastModified` is
 *  an optional header value — safeFetch does not currently surface response
 *  headers, so the corpus path passes undefined; the param keeps the extractor
 *  complete + testable and ready if headers are ever threaded through. Pure. */
export function extractPageDate(html: string, lastModified?: string): string | null {
  const metaContent = (prop: string): string | null => {
    // content before OR after the property/name attribute
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*\\bcontent=["']([^"']+)["']` +
        `|<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`,
      "i",
    );
    const m = re.exec(html);
    return m ? (m[1] ?? m[2] ?? null) : null;
  };
  const candidates: (string | null)[] = [
    metaContent("article:published_time"),
    metaContent("article:modified_time"),
    /<time[^>]+datetime=["']([^"']+)["']/i.exec(html)?.[1] ?? null,
    jsonLdDate(html, "datePublished"),
    jsonLdDate(html, "dateModified"),
    lastModified ?? null,
  ];
  for (const c of candidates) {
    if (!c) continue;
    const iso = parseDate(c);
    if (iso) return iso;
  }
  return null;
}

/** First `field` (datePublished/dateModified) found in any JSON-LD block, walking
 *  nested objects/arrays. Best-effort: bad JSON is skipped. */
function jsonLdDate(html: string, field: string): string | null {
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const b of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(b[1].trim());
    } catch {
      continue;
    }
    const found = walkForField(parsed, field);
    if (found) return found;
  }
  return null;
}

function walkForField(node: unknown, field: string): string | null {
  if (Array.isArray(node)) {
    for (const x of node) {
      const f = walkForField(x, field);
      if (f) return f;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const direct = obj[field];
    if (typeof direct === "string" && direct.trim()) return direct;
    for (const v of Object.values(obj)) {
      const f = walkForField(v, field);
      if (f) return f;
    }
  }
  return null;
}

const REVIEW_CLAIM_HOSTS = new Set(["g2.com", "capterra.com", "trustradius.com"]);

/** Contact extraction — scrape outlet contact signals from a cited
 *  page's HTML: the first mailto address, the first internal link whose path is an
 *  editorial/contribution/contact route, and (on known review platforms) the
 *  vendor-claim URL. Resolves relative links against `pageUrl`. Returns null when
 *  nothing is found. Pure + unit-tested. */
export function extractContact(html: string, pageUrl: string): ContactSignals | null {
  const out: ContactSignals = {};

  const mailto = /href=["']mailto:([^"'?>\s]+)/i.exec(html);
  if (mailto?.[1] && mailto[1].includes("@")) out.mailto = mailto[1].trim();

  const FORM_PATH = /(?:write-for-us|contribute|submit|contact|editorial)/i;
  let base: URL | null = null;
  try {
    base = new URL(pageUrl);
  } catch {
    /* unparseable page url — relative links can't be resolved */
  }
  if (base) {
    const hrefs = html.matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)["']/gi);
    for (const h of hrefs) {
      let abs: URL;
      try {
        abs = new URL(h[1], base);
      } catch {
        continue;
      }
      if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
      if (FORM_PATH.test(abs.pathname)) {
        out.form_url = abs.toString();
        break;
      }
    }
    const claim = claimUrlFor(base);
    if (claim) out.claim_url = claim;
  }

  return out.mailto || out.form_url || out.claim_url ? out : null;
}

/** Vendor-claim URL for the known review platforms (deterministic patterns, no
 *  guessing — null off-platform). G2 derives the product-specific take_ownership
 *  route from the URL slug; Capterra/TrustRadius return their vendor entry point. */
function claimUrlFor(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (!REVIEW_CLAIM_HOSTS.has(host)) return null;
  if (host === "g2.com") {
    const slug = /^\/products\/([^/]+)/.exec(u.pathname)?.[1];
    return slug ? `https://www.g2.com/products/${slug}/take_ownership` : "https://sell.g2.com/";
  }
  if (host === "capterra.com") return "https://www.capterra.com/vendors/sign-up";
  return "https://www.trustradius.com/vendor"; // trustradius.com
}

/** Depth targets — measured depth of a cited page: an approximate
 *  word count from the (script/style-stripped) text answer engines read, and the
 *  content-heading (h2/h3) count. Word count is labeled "~" downstream because the
 *  text is stripped + capped. Pure. */
export function measureDepth(rawHtml: string, text: string): { word_count: number; section_count: number } {
  const word_count = text.trim() ? text.trim().split(/\s+/).length : 0;
  const section_count = (rawHtml.match(/<h[23][\s>]/gi) ?? []).length;
  return { word_count, section_count };
}

export function aggregateCitations(answers: AnswerRow[]): Agg[] {
  const map = new Map<string, Agg>();
  for (const a of answers) {
    if (!a.ok) continue;
    for (const c of a.citations) {
      const key = normUrl(c.url);
      const agg = map.get(key) ?? { url: c.url, title: c.title, cited_by: {}, cited_for_qids: new Set() };
      agg.cited_by[a.engine] = (agg.cited_by[a.engine] ?? 0) + 1;
      agg.cited_for_qids.add(a.qid);
      if (!agg.title && c.title) agg.title = c.title;
      map.set(key, agg);
    }
  }
  const total = (x: Agg) => Object.values(x.cited_by).reduce((s, n) => s + (n ?? 0), 0);
  return [...map.values()].sort((a, b) => total(b) - total(a));
}

export async function buildCorpus(
  answers: AnswerRow[],
  bm: BrandModel,
  db: DbWriter,
  runId: string,
  opts: { top?: number; concurrency?: number; fetcher?: typeof safeFetch } = {},
): Promise<EnrichedCorpusPageRow[]> {
  const { top = 60, concurrency = 8, fetcher = safeFetch } = opts;
  await db.setStage(runId, "Reading the pages the engines cited");

  const aggs = aggregateCitations(answers).slice(0, top);

  let read = 0;
  // Cited pages that block unknown agents (reddit &c. 401/403/429, or unreachable
  // =0) otherwise land as brand_present=null, blinding the report on the exact
  // pages AI answers are built from. Fall back to the PUBLIC Wayback snapshot
  // (never impersonate the site — same project stance as crawl).
  // Cap lookups so an all-blocked run can't add minutes; over the cap, remaining
  // failures stay "unverified" as before.
  const MAX_ARCHIVE_LOOKUPS = 25;
  let archiveLookups = 0;
  // 8 pool workers hitting archive.org at once trips 429s. Serialize the
  // availability lookups through a promise-chain gate with ~300ms spacing.
  let archiveGate: Promise<unknown> = Promise.resolve();
  const throttledSnapshot = (u: string): Promise<string | null> => {
    const run = archiveGate.then(() => archiveSnapshotUrl(u, fetcher));
    archiveGate = run.then(() => sleep(300), () => sleep(300));
    return run;
  };
  const fetched = await pool(aggs, concurrency, async (agg, i) => {
    if (i > 0) await sleep(100); // spacing
    let res = await fetcher(agg.url);
    if ([0, 401, 403, 429].includes(res.status) && archiveLookups < MAX_ARCHIVE_LOOKUPS) {
      archiveLookups++;
      // Look up the RESOLVED target: a raw Gemini vertexaisearch wrapper URL is
      // never archived, but the page it redirects to is (safeFetch returns
      // finalUrl even on failure).
      const snap = await throttledSnapshot(res.finalUrl ?? agg.url);
      if (snap) {
        // Honest provenance: final_url becomes the archive URL (the PageDrawer
        // opens it, so the reader lands on the copy actually read) and
        // fetch_status records the archive fetch, never the blocked live page.
        // Wayback 302-redirects id_ URLs to the nearest concrete capture, so
        // pin final_url to the copy actually read (ares.finalUrl).
        const ares = await fetcher(snap);
        if (ares.status === 200 && ares.text) {
          res = { status: ares.status, finalUrl: ares.finalUrl ?? snap, text: ares.text };
        }
      }
    }
    read++;
    try {
      const host = new URL(unwrapArchiveUrl(res.finalUrl ?? agg.url)).hostname.replace(/^www\./, "");
      await db.setStage(
        runId,
        `Reading the pages the engines cited · ${host} (${read}/${aggs.length})`,
      );
    } catch {
      /* cosmetic */
    }
    return { agg, res };
  });

  // merge rows whose FINAL urls normalize to the same page (Gemini redirects)
  const merged = new Map<string, EnrichedCorpusPageRow>();
  for (const { agg, res } of fetched) {
    const ok = res.status >= 200 && res.status < 400 && !!res.text;
    const finalUrl = res.status !== 0 ? res.finalUrl : null;
    // final_url is provenance (the archive copy read); IDENTITY — host,
    // classification, merge key — is always the original page, recovered by
    // unwrapping the Wayback snapshot URL.
    const canonicalUrl = unwrapArchiveUrl(finalUrl ?? agg.url);
    const key = normUrl(canonicalUrl);

    let title = agg.title ? decodeEntities(agg.title) : null;
    if (ok) {
      // A <title> is raw HTML source, and a fair number of CMSes escape an
      // already-escaped string — decode the whole chain once, here, so a title
      // is stored as the text a human reads ("Ranked & Compared").
      const t = decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(res.text)?.[1] ?? "").trim();
      if (t) title = t;
    }

    const host = (() => {
      try {
        return new URL(canonicalUrl).hostname;
      } catch {
        return "";
      }
    })();
    const pageType = classifyPage({
      host,
      title: title ?? "",
      url: canonicalUrl,
      brandDomain: bm.domain,
    });

    // Presence extraction runs AFTER classification: a fetched video page is a
    // JS shell, so wordPresent over it fakes a verified absence — video pages
    // stay unverified (null), never a guessed brand_present.
    let brandPresent: boolean | null = null;
    let brandContext: string | null = null;
    let competitorsPresent: string[] = [];
    // Crawler v2 (TODO "Crawler v2") — honest SPA/thin flag on the cited page the
    // PageDrawer shows: extracted text is thin AND the raw HTML is a JS shell.
    let thin = false;
    // Enrichment computed from the fetched HTML while it's in hand.
    let pageDate: string | null = null;
    let contact: ContactSignals | null = null;
    let wordCount: number | undefined;
    let sectionCount: number | undefined;
    if (ok) {
      const text = stripHtmlToText(res.text);
      thin = classifyThin(res.text, text);
      if (pageType !== "video") {
        const alias = bm.aliases.find((al) => wordPresent(al, text));
        brandPresent = !!alias;
        brandContext = alias ? contextExcerpt(alias, text) : null;
        competitorsPresent = bm.competitors.filter((c) => wordPresent(c, text));
      }
      pageDate = extractPageDate(res.text);
      contact = extractContact(res.text, canonicalUrl);
      const depth = measureDepth(res.text, text);
      wordCount = depth.word_count;
      sectionCount = depth.section_count;
    }

    const existing = merged.get(key);
    if (existing) {
      // same final page cited under different raw urls — merge counts/qids
      for (const [eng, n] of Object.entries(agg.cited_by)) {
        const e = eng as Engine;
        existing.cited_by[e] = (existing.cited_by[e] ?? 0) + (n ?? 0);
      }
      existing.cited_for_qids = [...new Set([...existing.cited_for_qids, ...agg.cited_for_qids])];
      // enrichment: keep the first confident value, else adopt this fetch's (a later
      // ok/archive fetch can supply what the first, failed, fetch could not).
      existing.page_date = existing.page_date ?? pageDate;
      existing.contact = existing.contact ?? contact;
      existing.word_count = existing.word_count ?? wordCount;
      existing.section_count = existing.section_count ?? sectionCount;
      // never upgrade a video row (its presence is enforced-null) to a verified value
      if (
        existing.page_type !== "video" &&
        existing.brand_present === null &&
        brandPresent !== null
      ) {
        existing.brand_present = brandPresent;
        existing.brand_context = brandContext;
        existing.competitors_present = competitorsPresent;
        existing.fetch_status = res.status;
        existing.final_url = finalUrl;
        existing.title = title ?? existing.title;
        existing.thin = thin; // thin flag follows the page actually read
      }
      continue;
    }

    merged.set(key, {
      url: agg.url,
      final_url: finalUrl,
      title,
      page_type: pageType,
      cited_by: agg.cited_by,
      cited_for_qids: [...agg.cited_for_qids],
      fetch_status: res.status || null,
      brand_present: brandPresent,
      brand_context: brandContext,
      competitors_present: competitorsPresent,
      thin,
      // the spec (see METHODOLOGY.md): opportunity = brand absent && competitors present && not brand-owned
      opportunity: false, // set below (page_type known here, presence maybe merged later)
      // Enrichment (page_date + contact persisted; depth transient)
      page_date: pageDate,
      contact,
      word_count: wordCount,
      section_count: sectionCount,
    });
  }

  const rows = [...merged.values()];
  for (const row of rows) {
    row.opportunity =
      row.brand_present === false &&
      row.competitors_present.length > 0 &&
      row.page_type !== "brand_owned";
    await db.saveCorpusPage({ ...row, runId });
  }
  return rows;
}
