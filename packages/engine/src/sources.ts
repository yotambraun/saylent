// SOURCE INTELLIGENCE: where the answers come from, who they name, and which
// off-site pages are worth winning. Built ONLY from data a run already stored
// (the canonical answers with their verdicts and citations, plus the cited
// pages the corpus stage read), so every number is a count with receipts: each
// one lists the exact (question, engine) answers behind it.
//
// Three reads, one pass:
//   citation share   which domains (and pages) the answers cite, how often,
//                    per engine/surface, each domain classified by a small,
//                    transparent rule set (classifyDomain) plus user overrides
//   share of voice   COUNTS of answers naming the brand vs each rival (and the
//                    brand's recommended count), per engine, with receipts
//   opportunities    off-site domains cited in answers that name a rival and
//                    not the brand, on category-stage questions (every type but
//                    "branded"): ranked by how many such answers cite them
//
// Definitions (METHODOLOGY.md "Sources & opportunities" mirrors these):
//   * An answer is counted once per (question, engine): the canonical answer
//     the report shows, never the extra sampled draws, so every receipt opens.
//   * "Names the brand" = the judge's verdict says brand_present. "Recommends"
//     = mention_type "recommended". A rival is "named" when the verdict lists
//     it in other_brands (the rivals the answer prefers or recommends).
//   * "Rival-won answer" = ok, judged, the brand is absent, at least one rival
//     is named. Branded questions ("is <brand> any good") are excluded from
//     opportunities: they are about you, not the category.
//   * An off-site opportunity is a domain that is not your site and not a
//     rival's (classifyDomain), is cited by at least one rival-won answer, and
//     on which the brand was NOT verified present on any page we read. Ranked by
//     evidence = the number of distinct rival-won answers citing it; ties by
//     engines, then citations, then host. No weights, no opaque score.
//
// PURE and client-safe (no util.ts, no cheerio, no node builtins): the app's
// run view and brand history import it in the browser bundle.
import { REVIEW_HOSTS, FORUM_HOSTS, WIKI_HOSTS, VIDEO_HOSTS, classifyPage, hostMatches } from "./classify";
import { competitorTokens, makeRivalOwner } from "./rival-owner";
import { canonicalBrand } from "./score";
import { normOtherBrands } from "./verdict-compat";

export const SOURCES_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// domain types
// ---------------------------------------------------------------------------

export const DOMAIN_TYPES = [
  "own_site",
  "rival_site",
  "review_site",
  "forum",
  "docs",
  "news",
  "marketplace",
  "reference",
  "video",
  "social",
  "editorial",
  "other",
] as const;
export type DomainType = (typeof DOMAIN_TYPES)[number];

export const DOMAIN_TYPE_LABEL: Readonly<Record<DomainType, string>> = {
  own_site: "Your site",
  rival_site: "Rival's site",
  review_site: "Review site",
  forum: "Forum / community",
  docs: "Docs / help",
  news: "News",
  marketplace: "Marketplace",
  reference: "Reference",
  video: "Video",
  social: "Social",
  editorial: "Blog / editorial",
  other: "Other",
};

export function isDomainType(v: unknown): v is DomainType {
  return typeof v === "string" && (DOMAIN_TYPES as readonly string[]).includes(v);
}

/** Marketplaces and app stores: listing pages buyers compare on. */
export const MARKETPLACE_HOSTS: readonly string[] = [
  "apps.apple.com",
  "play.google.com",
  "chromewebstore.google.com",
  "chrome.google.com",
  "marketplace.visualstudio.com",
  "marketplace.atlassian.com",
  "apps.shopify.com",
  "appsumo.com",
  "etsy.com",
  "ebay.com",
  "walmart.com",
  "aws.amazon.com",
];
/** amazon.com, amazon.de, amazon.co.uk ... */
const MARKETPLACE_PREFIX = /^(?:[a-z0-9-]+\.)*amazon\.[a-z.]{2,6}$/;

export const SOCIAL_HOSTS: readonly string[] = [
  "linkedin.com",
  "x.com",
  "twitter.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "threads.net",
  "bsky.app",
  "pinterest.com",
];

/** Review platforms the page classifier does not list but buyers use. */
const EXTRA_REVIEW_HOSTS: readonly string[] = ["getapp.com", "softwareadvice.com", "peerspot.com", "g2crowd.com"];
const EXTRA_REFERENCE_HOSTS: readonly string[] = ["britannica.com"];

const SUBDOMAIN_RULES: { re: RegExp; type: DomainType; label: string }[] = [
  { re: /^(?:docs?|developers?|dev|api|help|support|learn|kb|knowledge(?:base)?|academy)\./, type: "docs", label: "docs/help subdomain" },
  { re: /^(?:community|forums?|discuss(?:ions)?|answers)\./, type: "forum", label: "community subdomain" },
  { re: /^(?:news|press|newsroom)\./, type: "news", label: "news subdomain" },
  { re: /^(?:blog|blogs|insights|resources)\./, type: "editorial", label: "blog subdomain" },
  { re: /^(?:marketplace|apps|store)\./, type: "marketplace", label: "marketplace subdomain" },
];

/** page_type (classify.ts, one cited page) → the domain type it suggests. */
const PAGE_TYPE_TO_DOMAIN: Readonly<Record<string, DomainType>> = {
  listicle: "editorial",
  comparison: "editorial",
  docs: "docs",
  news: "news",
  review_platform: "review_site",
  forum: "forum",
  wiki: "reference",
  video: "video",
};

const PAGE_TYPE_NOUN: Readonly<Record<string, string>> = {
  listicle: "best-of listicles",
  comparison: "comparisons",
  docs: "docs or guides",
  news: "news",
  review_platform: "review listings",
  forum: "community threads",
  wiki: "reference entries",
  video: "videos",
};

export interface DomainClass {
  type: DomainType;
  /** the rule that decided it, in plain words ("your override", "review site
   *  list", "docs/help subdomain", "3 of 4 cited pages are best-of listicles") */
  rule: string;
  /** rival_site only: which rival owns it */
  rival?: string;
}

/** User overrides: host (or parent domain) → type. */
export interface SourceOverrides {
  domainTypes?: Record<string, DomainType>;
}

export interface ClassifyContext {
  brandDomain: string;
  competitors: string[];
  /** cited pages for redirect-ownership evidence (rival-owner.ts) */
  corpus?: { url: string; final_url?: string | null }[];
  overrides?: SourceOverrides | null;
  /** rivals the ANSWERS named (beyond the configured competitors). Matched
   *  strictly: a host is theirs only when its name label spells the rival's
   *  whole name ("hawkeye-monitor.example" for "Hawkeye Monitor"). */
  namedRivals?: string[];
}

const GENERIC_TAIL = new Set(["ai", "app", "hq", "io", "inc", "labs", "software", "cloud", "platform"]);

const collapse = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The label a site is named by: the registrable domain's first label
 *  ("hawkeye-monitor" in status.hawkeye-monitor.example). */
function nameLabel(host: string): string {
  const labels = host.split(".");
  return labels.length >= 2 ? labels[labels.length - 2] : (labels[0] ?? "");
}

const bareHost = (h: string) => h.trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");

function overrideFor(host: string, overrides: SourceOverrides | null | undefined): [string, DomainType] | null {
  const map = overrides?.domainTypes;
  if (!map) return null;
  let best: [string, DomainType] | null = null;
  for (const [rawKey, type] of Object.entries(map)) {
    if (!isDomainType(type)) continue;
    const key = bareHost(rawKey);
    if (!key) continue;
    if (host === key || host.endsWith(`.${key}`)) {
      if (!best || key.length > best[0].length) best = [key, type]; // the most specific wins
    }
  }
  return best;
}

/** A reusable classifier: build once per run (the rival-owner lookup reads the
 *  corpus), call per host. `pageTypes` = the page types of this host's cited
 *  pages, weighted by citations, for the last-resort rule. */
export function makeDomainClassifier(ctx: ClassifyContext) {
  const brandHost = bareHost(ctx.brandDomain);
  const rivalOwner = makeRivalOwner(ctx.competitors, ctx.corpus ?? []);
  const tokens = competitorTokens(ctx.competitors);
  // strict whole-name matches, configured competitors first, then answer-named
  const exact = new Map<string, string>();
  for (const name of [...ctx.competitors, ...(ctx.namedRivals ?? [])]) {
    const words = canonicalBrand(name).split(/[^a-z0-9]+/).filter(Boolean);
    // "Falconware AI" is also falconware.<tld>: a trailing company-form word is dropped
    const core = words.length > 1 && GENERIC_TAIL.has(words[words.length - 1]) ? words.slice(0, -1) : words;
    for (const key of new Set([collapse(words.join("")), collapse(core.join(""))])) {
      if (key.length >= 3 && !exact.has(key)) exact.set(key, name);
    }
  }
  return (rawHost: string, pageTypes: Map<string, number> = new Map()): DomainClass => {
    const host = bareHost(rawHost);
    const o = overrideFor(host, ctx.overrides);
    if (o) return { type: o[1], rule: o[0] === host ? "your override" : `your override for ${o[0]}` };
    if (brandHost && (host === brandHost || host.endsWith(`.${brandHost}`))) {
      return { type: "own_site", rule: "your domain" };
    }
    const inList = (list: readonly string[]) => list.some((h) => hostMatches(host, h));
    if (inList(REVIEW_HOSTS) || inList(EXTRA_REVIEW_HOSTS)) return { type: "review_site", rule: "known review site" };
    if (inList(FORUM_HOSTS)) return { type: "forum", rule: "known community site" };
    if (inList(WIKI_HOSTS) || inList(EXTRA_REFERENCE_HOSTS)) return { type: "reference", rule: "known reference site" };
    if (inList(VIDEO_HOSTS)) return { type: "video", rule: "known video site" };
    if (inList(MARKETPLACE_HOSTS) || MARKETPLACE_PREFIX.test(host)) return { type: "marketplace", rule: "known marketplace" };
    if (inList(SOCIAL_HOSTS)) return { type: "social", rule: "known social network" };
    const exactRival = exact.get(collapse(nameLabel(host)));
    if (exactRival) return { type: "rival_site", rule: `named after ${exactRival}`, rival: exactRival };
    const rival = rivalOwner(host);
    if (rival) {
      const token = tokens.find((t) => t.name === rival && host.includes(t.token))?.token;
      return {
        type: "rival_site",
        rule: token ? `host contains "${token}" (${rival})` : `a ${rival} domain redirects here`,
        rival,
      };
    }
    for (const r of SUBDOMAIN_RULES) if (r.re.test(host)) return { type: r.type, rule: r.label };
    // last resort: what its cited pages look like (classify.ts page types)
    let total = 0;
    for (const n of pageTypes.values()) total += n;
    const top = [...pageTypes.entries()]
      .filter(([t]) => PAGE_TYPE_TO_DOMAIN[t])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (top && total > 0 && top[1] * 2 >= total) {
      return {
        type: PAGE_TYPE_TO_DOMAIN[top[0]],
        rule: `${top[1]} of ${total} citations point to ${PAGE_TYPE_NOUN[top[0]] ?? top[0]}`,
      };
    }
    return { type: "other", rule: "no rule matched" };
  };
}

// ---------------------------------------------------------------------------
// inputs (loose, so bundle rows, DB rows and dossier rows all fit)
// ---------------------------------------------------------------------------

type VerdictLike = {
  brand_present?: unknown;
  mention_type?: unknown;
  other_brands?: unknown;
  excerpt?: unknown;
} | null | undefined;

export interface SourceAnswerInput {
  qid: string;
  engine: string;
  qtype?: string | null;
  question?: string | null;
  ok: boolean;
  citations?: { url: string; title?: string | null }[] | null;
  verdict?: VerdictLike;
}

export interface SourcePageInput {
  url: string;
  final_url?: string | null;
  title?: string | null;
  page_type?: string | null;
  brand_present?: boolean | null;
  competitors_present?: string[] | null;
}

export interface SourceBrandInput {
  name: string;
  domain: string;
  aliases?: string[] | null;
  competitors?: string[] | null;
}

// ---------------------------------------------------------------------------
// outputs (the run.json `sources` block; schema_version guards its meaning)
// ---------------------------------------------------------------------------

/** One answer behind a number: open it by (qid, engine). */
export interface SourceRef {
  qid: string;
  engine: string;
}

export interface SourceReceipt extends SourceRef {
  question: string;
  /** the cited URLs on this domain, in answer order (≤2) */
  urls: string[];
  /** rivals the answer named, with the answer's stated reason ("" when none) */
  rivals: { name: string; why: string }[];
}

export interface DomainPage {
  url: string;
  title: string | null;
  citations: number;
  /** from the page we read: true/false; null = not read (or unreadable) */
  brandOnPage: boolean | null;
  rivalsOnPage: string[];
}

export interface DomainSource {
  host: string;
  type: DomainType;
  typeRule: string;
  rival?: string;
  /** citation rows across the counted answers */
  citations: number;
  /** citations / every citation in the run (0..1) */
  share: number;
  /** distinct answers citing it */
  answers: number;
  byEngine: Record<string, number>;
  /** answers citing it that name the brand / that are rival-won */
  brandNamedAnswers: number;
  rivalWonAnswers: number;
  /** top cited pages on this domain (≤5) */
  pages: DomainPage[];
  /** every answer citing it */
  refs: SourceRef[];
}

export interface VoiceEntry {
  name: string;
  isBrand: boolean;
  /** answers naming it */
  named: number;
  /** answers recommending it (the brand only; null for rivals, whose verdict
   *  fields do not separate "recommended" from "preferred") */
  recommended: number | null;
  byEngine: Record<string, number>;
  refs: SourceRef[];
}

export type OpportunityPageCheck = "rivals_on_page" | "brand_missing" | "unread";

export interface Opportunity {
  host: string;
  type: DomainType;
  typeRule: string;
  /** distinct rival-won, non-branded answers citing this domain */
  evidence: number;
  engines: string[];
  qids: string[];
  citations: number;
  /** rivals named in those answers, most often first */
  rivals: { name: string; count: number }[];
  /** what the pages we read on this domain show */
  pageCheck: OpportunityPageCheck;
  /** pages we read on it, and the rivals verified on them */
  pagesRead: number;
  rivalsOnPages: string[];
  /** answers citing this domain that DO name the brand (context, not evidence) */
  brandNamedAnswers: number;
  /** the composed one-line reason, rendered verbatim by every view */
  why: string;
  /** the top cited page on this domain (the one to pitch first) */
  topPage: { url: string; title: string | null } | null;
  receipts: SourceReceipt[];
}

export interface EngineSourceSummary {
  engine: string;
  answers: number;
  citations: number;
  domains: number;
  topDomains: { host: string; citations: number }[];
}

export interface SourceIntelligence {
  schema_version: typeof SOURCES_SCHEMA_VERSION;
  totals: {
    /** ok canonical answers */
    answers: number;
    answersWithCitations: number;
    citations: number;
    domains: number;
    /** rival-won, non-branded answers (the opportunity denominator) */
    rivalWonAnswers: number;
  };
  engines: EngineSourceSummary[];
  /** every cited domain, most cited first */
  domains: DomainSource[];
  byType: { type: DomainType; citations: number; domains: number }[];
  voice: VoiceEntry[];
  opportunities: Opportunity[];
  /** the overrides this was computed with, so a re-render reproduces it */
  overrides: SourceOverrides | null;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// Keep in sync with util.ts ARCHIVE_WRAP / citation-host.ts (duplicated so this
// module stays free of util.ts's cheerio import; a test pins the two).
const ARCHIVE_WRAP = /^https?:\/\/web\.archive\.org\/web\/\d+(?:id_)?\/(https?:\/\/.+)$/;
const VERTEX_REDIRECT_HOST = "vertexaisearch.cloud.google.com";
const BARE_HOST = /^([a-z0-9-]+\.)+[a-z]{2,}$/i;

/** citation-host.ts citationHost, client-safe: the real source host,
 *  www-stripped, archive snapshots and Gemini grounding redirects unwrapped. */
export function sourceHost(url: string, title?: string | null): string {
  const unwrapped = ARCHIVE_WRAP.exec(url)?.[1] ?? url;
  let host = "";
  try {
    host = new URL(unwrapped).hostname.toLowerCase();
  } catch {
    host = "";
  }
  if (host === VERTEX_REDIRECT_HOST && title) {
    const t = title.trim().toLowerCase().replace(/^www\./, "");
    if (BARE_HOST.test(t)) return t;
  }
  return host.replace(/^www\./, "");
}

/** A light URL key for joining citations to corpus pages: host www-stripped,
 *  no hash, no tracking params, no trailing slash. */
export function pageKey(url: string): string {
  const unwrapped = ARCHIVE_WRAP.exec(url)?.[1] ?? url;
  try {
    const u = new URL(unwrapped);
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|srsltid$|gclid$|fbclid$)/i.test(k)) u.searchParams.delete(k);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    const q = u.searchParams.toString();
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${path}${q ? `?${q}` : ""}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

const isPresent = (v: VerdictLike) => !!v && typeof v === "object" && v.brand_present === true;
const isAbsent = (v: VerdictLike) =>
  !!v && typeof v === "object" && (v.brand_present === false || v.mention_type === "absent");
const isJudged = (v: VerdictLike) => !!v && typeof v === "object" && typeof v.brand_present === "boolean";

function inc<K>(m: Map<K, number>, k: K, n = 1) {
  m.set(k, (m.get(k) ?? 0) + n);
}

const byCountThenName = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0]);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function listNames(names: string[], max = 2): string {
  if (names.length === 0) return "";
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${plural(rest, "other")}`;
  return shown.length === 2 ? `${shown[0]} and ${shown[1]}` : shown[0];
}

// ---------------------------------------------------------------------------
// the one computation
// ---------------------------------------------------------------------------

export interface BuildSourcesInput {
  brand: SourceBrandInput;
  answers: SourceAnswerInput[];
  corpus?: SourcePageInput[] | null;
  overrides?: SourceOverrides | null;
  /** opportunities kept (default 12) */
  maxOpportunities?: number;
  /** receipts kept per opportunity (default 6) */
  maxReceipts?: number;
}

export function buildSourceIntelligence(input: BuildSourcesInput): SourceIntelligence {
  const { brand } = input;
  const corpus = input.corpus ?? [];
  const maxOpps = input.maxOpportunities ?? 12;
  const maxReceipts = input.maxReceipts ?? 6;
  const competitors = (brand.competitors ?? []).filter(Boolean);
  const self = new Set([brand.name, ...(brand.aliases ?? [])].map((n) => canonicalBrand(n)).filter(Boolean));
  const isSelf = (name: string) => self.has(canonicalBrand(name));

  // corpus pages by key (url and final_url both resolve)
  const pageByKey = new Map<string, SourcePageInput>();
  for (const p of corpus) {
    pageByKey.set(pageKey(p.url), p);
    if (p.final_url) pageByKey.set(pageKey(p.final_url), p);
  }

  const answers = input.answers.filter((a) => a.ok);
  const engineOrder: string[] = [];
  for (const a of answers) if (!engineOrder.includes(a.engine)) engineOrder.push(a.engine);

  interface DomAcc {
    citations: number;
    byEngine: Map<string, number>;
    refs: SourceRef[];
    refKeys: Set<string>;
    brandNamed: Set<string>;
    rivalWon: Set<string>;
    pages: Map<string, { url: string; title: string | null; citations: number }>;
    pageTypes: Map<string, number>;
  }
  const domains = new Map<string, DomAcc>();
  interface OppAcc {
    answers: Map<string, SourceReceipt>;
    rivals: Map<string, number>;
    engines: Set<string>;
  }
  const opps = new Map<string, OppAcc>();
  const engineAgg = new Map<string, { answers: number; citations: number; hosts: Map<string, number> }>();
  let totalCitations = 0;
  let answersWithCitations = 0;
  let rivalWonTotal = 0;

  // voice accumulators
  interface VoiceAcc {
    display: string;
    named: number;
    recommended: number;
    byEngine: Map<string, number>;
    refs: SourceRef[];
  }
  const brandVoice: VoiceAcc = { display: brand.name, named: 0, recommended: 0, byEngine: new Map(), refs: [] };
  const rivalVoice = new Map<string, VoiceAcc>();

  for (const a of answers) {
    const ref: SourceRef = { qid: a.qid, engine: a.engine };
    const refKey = `${a.qid}|${a.engine}`;
    const v = a.verdict;
    const eng = engineAgg.get(a.engine) ?? { answers: 0, citations: 0, hosts: new Map() };
    eng.answers += 1;
    engineAgg.set(a.engine, eng);

    // ---- voice ----
    const rivalsNamed: { name: string; why: string }[] = [];
    const seenRival = new Set<string>();
    for (const ob of normOtherBrands(v)) {
      if (!ob.name || isSelf(ob.name)) continue;
      const key = canonicalBrand(ob.name);
      if (!key || seenRival.has(key)) continue;
      seenRival.add(key);
      rivalsNamed.push({ name: ob.name, why: ob.why });
      const acc: VoiceAcc = rivalVoice.get(key) ?? { display: ob.name, named: 0, recommended: 0, byEngine: new Map(), refs: [] };
      acc.named += 1;
      inc(acc.byEngine, a.engine);
      acc.refs.push(ref);
      if (ob.name.length < acc.display.length) acc.display = ob.name;
      rivalVoice.set(key, acc);
    }
    if (isPresent(v)) {
      brandVoice.named += 1;
      inc(brandVoice.byEngine, a.engine);
      brandVoice.refs.push(ref);
      if (v?.mention_type === "recommended") brandVoice.recommended += 1;
    }
    const rivalWon = isJudged(v) && isAbsent(v) && rivalsNamed.length > 0;
    const categoryStage = (a.qtype ?? "") !== "branded";
    if (rivalWon && categoryStage) rivalWonTotal += 1;

    // ---- citations ----
    const cites = (a.citations ?? []).filter((c) => typeof c?.url === "string" && c.url.trim());
    if (cites.length > 0) answersWithCitations += 1;
    const hostsInAnswer = new Map<string, string[]>();
    for (const c of cites) {
      const url = c.url.trim();
      const host = sourceHost(url, c.title ?? null);
      if (!host) continue;
      totalCitations += 1;
      eng.citations += 1;
      inc(eng.hosts, host);
      const d: DomAcc =
        domains.get(host) ??
        ({
          citations: 0,
          byEngine: new Map(),
          refs: [],
          refKeys: new Set(),
          brandNamed: new Set(),
          rivalWon: new Set(),
          pages: new Map(),
          pageTypes: new Map(),
        } satisfies DomAcc);
      d.citations += 1;
      inc(d.byEngine, a.engine);
      if (!d.refKeys.has(refKey)) {
        d.refKeys.add(refKey);
        d.refs.push(ref);
      }
      if (isPresent(v)) d.brandNamed.add(refKey);
      if (rivalWon) d.rivalWon.add(refKey);
      const key = pageKey(url);
      const corpusPage = pageByKey.get(key);
      const title = (corpusPage?.title ?? c.title ?? null) || null;
      const pg = d.pages.get(key) ?? { url, title, citations: 0 };
      pg.citations += 1;
      if (!pg.title && title) pg.title = title;
      d.pages.set(key, pg);
      const pageType =
        corpusPage?.page_type ?? classifyPage({ host, title: title ?? "", url, brandDomain: brand.domain });
      inc(d.pageTypes, pageType);
      domains.set(host, d);
      const list = hostsInAnswer.get(host) ?? [];
      if (list.length < 2 && !list.includes(url)) list.push(url);
      hostsInAnswer.set(host, list);
    }

    // ---- opportunity evidence ----
    if (rivalWon && categoryStage) {
      for (const [host, urls] of hostsInAnswer) {
        const o = opps.get(host) ?? { answers: new Map(), rivals: new Map(), engines: new Set() };
        if (!o.answers.has(refKey)) {
          o.answers.set(refKey, {
            qid: a.qid,
            engine: a.engine,
            question: a.question ?? "",
            urls,
            rivals: rivalsNamed.slice(0, 3),
          });
          for (const r of rivalsNamed) inc(o.rivals, r.name);
          o.engines.add(a.engine);
        }
        opps.set(host, o);
      }
    }
  }

  // ---- classify every cited domain ----
  const classify = makeDomainClassifier({
    brandDomain: brand.domain,
    competitors,
    corpus,
    overrides: input.overrides ?? null,
    namedRivals: [...rivalVoice.values()].map((r) => r.display),
  });

  // pages read per host (corpus) — presence evidence at the domain level
  const readByHost = new Map<string, SourcePageInput[]>();
  for (const p of corpus) {
    const host = sourceHost(p.final_url ?? p.url, p.title ?? null) || sourceHost(p.url, p.title ?? null);
    if (!host) continue;
    const list = readByHost.get(host) ?? [];
    list.push(p);
    readByHost.set(host, list);
  }

  const domainRows: DomainSource[] = [...domains.entries()]
    .map(([host, d]) => {
      const cls = classify(host, d.pageTypes);
      const pages: DomainPage[] = [...d.pages.entries()]
        .sort((x, y) => y[1].citations - x[1].citations || x[1].url.localeCompare(y[1].url))
        .slice(0, 5)
        .map(([key, p]) => {
          const cp = pageByKey.get(key);
          return {
            url: p.url,
            title: p.title,
            citations: p.citations,
            brandOnPage: cp?.brand_present ?? null,
            rivalsOnPage: (cp?.competitors_present ?? []).filter(Boolean),
          };
        });
      const row: DomainSource = {
        host,
        type: cls.type,
        typeRule: cls.rule,
        ...(cls.rival ? { rival: cls.rival } : {}),
        citations: d.citations,
        share: totalCitations > 0 ? d.citations / totalCitations : 0,
        answers: d.refs.length,
        byEngine: Object.fromEntries(engineOrder.filter((e) => d.byEngine.has(e)).map((e) => [e, d.byEngine.get(e) ?? 0])),
        brandNamedAnswers: d.brandNamed.size,
        rivalWonAnswers: d.rivalWon.size,
        pages,
        refs: d.refs,
      };
      return row;
    })
    .sort((a, b) => b.citations - a.citations || b.answers - a.answers || a.host.localeCompare(b.host));
  const domainByHost = new Map(domainRows.map((d) => [d.host, d]));

  // ---- by type ----
  const typeAgg = new Map<DomainType, { citations: number; domains: number }>();
  for (const d of domainRows) {
    const t = typeAgg.get(d.type) ?? { citations: 0, domains: 0 };
    t.citations += d.citations;
    t.domains += 1;
    typeAgg.set(d.type, t);
  }
  const byType = [...typeAgg.entries()]
    .map(([type, t]) => ({ type, ...t }))
    .sort((a, b) => b.citations - a.citations || DOMAIN_TYPES.indexOf(a.type) - DOMAIN_TYPES.indexOf(b.type));

  // ---- per engine ----
  const engines: EngineSourceSummary[] = engineOrder.map((engine) => {
    const e = engineAgg.get(engine) ?? { answers: 0, citations: 0, hosts: new Map() };
    return {
      engine,
      answers: e.answers,
      citations: e.citations,
      domains: e.hosts.size,
      topDomains: [...e.hosts.entries()]
        .sort(byCountThenName)
        .slice(0, 5)
        .map(([host, citations]) => ({ host, citations })),
    };
  });

  // ---- voice ----
  const toEntry = (acc: VoiceAcc, isBrand: boolean): VoiceEntry => ({
    name: acc.display,
    isBrand,
    named: acc.named,
    recommended: isBrand ? acc.recommended : null,
    byEngine: Object.fromEntries(engineOrder.filter((e) => acc.byEngine.has(e)).map((e) => [e, acc.byEngine.get(e) ?? 0])),
    refs: acc.refs,
  });
  const rivals = [...rivalVoice.values()]
    .sort((a, b) => b.named - a.named || a.display.localeCompare(b.display))
    .slice(0, 12)
    .map((acc) => toEntry(acc, false));
  const voice = [toEntry(brandVoice, true), ...rivals].sort(
    (a, b) => b.named - a.named || Number(b.isBrand) - Number(a.isBrand) || a.name.localeCompare(b.name),
  );

  // ---- opportunities ----
  const opportunities: Opportunity[] = [];
  for (const [host, o] of opps) {
    const d = domainByHost.get(host);
    if (!d || d.type === "own_site" || d.type === "rival_site") continue;
    const read = (readByHost.get(host) ?? []).filter((p) => p.brand_present === true || p.brand_present === false);
    if (read.some((p) => p.brand_present === true)) continue; // you are on it: not an off-site gap
    const rivalsOnPages = [...new Set(read.flatMap((p) => (p.competitors_present ?? []).filter(Boolean)))];
    const pageCheck: OpportunityPageCheck =
      read.length === 0 ? "unread" : rivalsOnPages.length > 0 ? "rivals_on_page" : "brand_missing";
    const rivalList = [...o.rivals.entries()].sort(byCountThenName).map(([name, count]) => ({ name, count }));
    const receipts = [...o.answers.values()];
    const evidence = receipts.length;
    const engineList = engineOrder.filter((e) => o.engines.has(e));
    const qids = [...new Set(receipts.map((r) => r.qid))];
    const named = listNames(rivalList.map((r) => r.name));
    const pageLine =
      pageCheck === "rivals_on_page"
        ? ` We read ${plural(read.length, "page")} on it: ${listNames(rivalsOnPages)} ${rivalsOnPages.length === 1 ? "is" : "are"} there, you are not.`
        : pageCheck === "brand_missing"
          ? ` We read ${plural(read.length, "page")} on it and you are not there.`
          : "";
    const why =
      `Cited in ${plural(evidence, "answer")} that name${evidence === 1 ? "s" : ""} ${named} and not you` +
      `, across ${plural(engineList.length, "engine")} and ${plural(qids.length, "question")}.` +
      pageLine;
    opportunities.push({
      host,
      type: d.type,
      typeRule: d.typeRule,
      evidence,
      engines: engineList,
      qids,
      citations: d.citations,
      rivals: rivalList,
      pageCheck,
      pagesRead: read.length,
      rivalsOnPages,
      brandNamedAnswers: d.brandNamedAnswers,
      why,
      topPage: d.pages[0] ? { url: d.pages[0].url, title: d.pages[0].title } : null,
      receipts: receipts.slice(0, maxReceipts),
    });
  }
  opportunities.sort(
    (a, b) =>
      b.evidence - a.evidence ||
      b.engines.length - a.engines.length ||
      b.citations - a.citations ||
      a.host.localeCompare(b.host),
  );

  return {
    schema_version: SOURCES_SCHEMA_VERSION,
    totals: {
      answers: answers.length,
      answersWithCitations,
      citations: totalCitations,
      domains: domainRows.length,
      rivalWonAnswers: rivalWonTotal,
    },
    engines,
    domains: domainRows,
    byType,
    voice,
    opportunities: opportunities.slice(0, maxOpps),
    overrides: input.overrides && Object.keys(input.overrides.domainTypes ?? {}).length ? input.overrides : null,
  };
}

/** Read a stored `sources` block only when its schema is one this build
 *  understands; anything else is recomputed by the caller. */
export function readStoredSources(value: unknown): SourceIntelligence | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { schema_version?: unknown };
  return v.schema_version === SOURCES_SCHEMA_VERSION ? (value as SourceIntelligence) : null;
}

// ---------------------------------------------------------------------------
// across history
// ---------------------------------------------------------------------------

export interface SourceHistoryRun {
  runId: string;
  /** ISO date the run was created/finished */
  date: string;
  intel: SourceIntelligence;
}

export interface SourceHistory {
  runs: { runId: string; date: string; answers: number; citations: number; opportunities: number; brandNamed: number }[];
  /** domains cited in any run: citations per run (same order as `runs`, 0 =
   *  not cited), how many runs listed it as an opportunity, and the latest type */
  domains: {
    host: string;
    type: DomainType;
    citations: number[];
    opportunityRuns: number;
    /** the last run's opportunity evidence (0 when it was not one) */
    latestEvidence: number;
  }[];
  /** named counts per run for the brand and the rivals named most overall */
  voice: { name: string; isBrand: boolean; named: number[] }[];
}

/** Fold per-run source intelligence (oldest first) into one history view. */
export function buildSourceHistory(runs: SourceHistoryRun[], opts: { maxDomains?: number; maxRivals?: number } = {}): SourceHistory {
  const maxDomains = opts.maxDomains ?? 15;
  const maxRivals = opts.maxRivals ?? 4;
  const sorted = [...runs].sort((a, b) => a.date.localeCompare(b.date));
  const n = sorted.length;
  const dom = new Map<string, { type: DomainType; citations: number[]; opportunityRuns: number; latestEvidence: number }>();
  sorted.forEach((r, i) => {
    for (const d of r.intel.domains) {
      const row = dom.get(d.host) ?? { type: d.type, citations: new Array(n).fill(0), opportunityRuns: 0, latestEvidence: 0 };
      row.citations[i] = d.citations;
      row.type = d.type;
      dom.set(d.host, row);
    }
    for (const o of r.intel.opportunities) {
      const row = dom.get(o.host);
      if (row) row.opportunityRuns += 1;
    }
  });
  const last = sorted[n - 1];
  for (const o of last?.intel.opportunities ?? []) {
    const row = dom.get(o.host);
    if (row) row.latestEvidence = o.evidence;
  }
  const domains = [...dom.entries()]
    .map(([host, d]) => ({ host, ...d }))
    .sort(
      (a, b) =>
        b.opportunityRuns - a.opportunityRuns ||
        b.citations.reduce((s, x) => s + x, 0) - a.citations.reduce((s, x) => s + x, 0) ||
        a.host.localeCompare(b.host),
    )
    .slice(0, maxDomains);

  const voiceTotals = new Map<string, { name: string; isBrand: boolean; named: number[] }>();
  sorted.forEach((r, i) => {
    for (const v of r.intel.voice) {
      const key = v.isBrand ? "\u0000brand" : canonicalBrand(v.name);
      const row = voiceTotals.get(key) ?? { name: v.name, isBrand: v.isBrand, named: new Array(n).fill(0) };
      row.named[i] = v.named;
      if (!v.isBrand && v.name.length < row.name.length) row.name = v.name;
      voiceTotals.set(key, row);
    }
  });
  const brandRow = voiceTotals.get("\u0000brand");
  const rivalRows = [...voiceTotals.values()]
    .filter((v) => !v.isBrand)
    .sort((a, b) => b.named.reduce((s, x) => s + x, 0) - a.named.reduce((s, x) => s + x, 0) || a.name.localeCompare(b.name))
    .slice(0, maxRivals);

  return {
    runs: sorted.map((r) => ({
      runId: r.runId,
      date: r.date,
      answers: r.intel.totals.answers,
      citations: r.intel.totals.citations,
      opportunities: r.intel.opportunities.length,
      brandNamed: r.intel.voice.find((v) => v.isBrand)?.named ?? 0,
    })),
    domains,
    voice: [...(brandRow ? [brandRow] : []), ...rivalRows],
  };
}
