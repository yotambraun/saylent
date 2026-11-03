// AI crawler analytics: stream access-log hits in (access-logs.ts), get one
// versioned CrawlerReport out: which AI bots came, what they fetched, what
// they were refused or broke on, whether their IPs check out, and, joined with
// an audit's run.json, which pages the AI answers cite that no AI bot fetched
// in the log window.
//
// PRIVACY: the log never leaves the machine (or the deployment). Receipts are
// the log line with the client IP redacted (IPv4 keeps two octets, IPv6 two
// hextets) and query strings cut, unless the caller asks for raw IPs. IPs are
// grouped by a keyed hash whose random key lives only for this report.
//
// MEMORY: one pass, bounded maps. At most MAX_PATHS distinct paths are tracked
// (the rest are counted as "other paths" and the report says so), receipts are
// capped per row, and non-bot hits are only counted.
//
// HONESTY: counts only. A page no AI bot fetched in this window is exactly
// that; we never say an answer cited a page BECAUSE a bot read it.
//
// AI REFERRALS: the same pass counts requests from people (no known bot user
// agent) that arrive from an AI assistant, by the Referer host or utm_source
// (ai-referrers.ts, the one list). It is a floor: an assistant visit with
// neither looks like direct traffic.
import { createHmac, randomBytes } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import { ENGINE_OPERATOR, PURPOSE_LABEL, botRegistry, makeBotMatcher, type AiBot, type BotPurpose } from "./ai-bots";
import { AI_REFERRERS_CHECKED, aiReferral, type AiAssistant } from "./ai-referrers";
import { readAccessLog, type AccessHit, type LogFileStats, type LogFormat } from "./access-logs";
import { loadBotRanges, verifyIp, type RangeFetch, type RangeSet, type RangeSource } from "./bot-ip-ranges";
import type { Readable } from "node:stream";
import type { ExtraBot } from "./config";

export const CRAWLER_REPORT_SCHEMA_VERSION = 1;
export const MAX_PATHS = 50_000;
export const MAX_PROBLEMS = 100;
export const MAX_PAGES = 200;
const RECEIPTS_PER_ROW = 3;

export type ProblemKind = "blocked" | "error" | "not_found" | "client_error";

export interface StatusCounts {
  "2xx": number;
  "3xx": number;
  "4xx": number;
  "5xx": number;
  other: number;
}

export interface BotRow {
  id: string;
  label: string;
  operator: string;
  purpose: BotPurpose;
  ai: boolean;
  registryVerified: boolean;
  docsUrl: string | null;
  hits: number;
  distinctPages: number;
  status: StatusCounts;
  /** 401/403/429 responses and firewall blocks/challenges */
  blocked: number;
  /** 5xx */
  errors: number;
  /** 404/410 */
  notFound: number;
  firstSeen: string | null;
  lastSeen: string | null;
  verification: { verified: number; unverified: number };
  topPages: { path: string; hits: number }[];
}

export interface PageRow {
  path: string;
  hits: number;
  bots: Record<string, number>;
  status: StatusCounts;
  lastSeen: string | null;
}

export interface ProblemRow {
  path: string;
  bot: string;
  botLabel: string;
  kind: ProblemKind;
  /** the exact status codes seen (a firewall decision with no status is "waf") */
  statuses: Record<string, number>;
  count: number;
  receipts: string[];
}

export interface SpoofRow {
  bot: string;
  botLabel: string;
  ip: string;
  hits: number;
  receipts: string[];
}

export interface CitedPageRow {
  url: string;
  path: string;
  /** the engines whose answers cited it, and the answers (≤5) */
  engines: string[];
  answers: { qid: string; engine: string }[];
  aiBotHits: number;
  bots: Record<string, number>;
  /** per citing engine: did a crawler of that engine's operator fetch it? */
  operatorFetched: Record<string, boolean>;
  problems: number;
}

export interface CrawlerJoin {
  runId: string;
  brandDomain: string;
  cited: CitedPageRow[];
  citedNotFetched: string[];
  citedWithProblems: string[];
  /** own pages the run read (corpus) that no AI bot fetched in the window */
  readNotFetched: string[];
  note: string;
}

/** Visits from one AI assistant: requests from a browser (no known bot user
 *  agent) whose Referer host or utm_source names it. */
export interface ReferralRow {
  id: string;
  label: string;
  operator: string;
  visits: number;
  viaReferrer: number;
  viaUtmSource: number;
  /** landing pages, most visits first (at most 10) */
  pages: { path: string; visits: number }[];
  firstSeen: string | null;
  lastSeen: string | null;
  /** up to three log lines, IP redacted and query strings cut */
  receipts: string[];
}

export interface ReferralSummary {
  visits: number;
  assistants: ReferralRow[];
  /** the date the assistant list was checked (ai-referrers.ts) */
  listChecked: string;
  note: string;
}

export const REFERRALS_NOTE =
  "Requests from browsers (no known bot user agent) whose Referer host or utm_source names an AI assistant. Many assistant visits carry neither (apps, privacy settings, copied links) and look like direct traffic, so this is a floor, not a total.";

export interface CrawlerReport {
  schema_version: typeof CRAWLER_REPORT_SCHEMA_VERSION;
  generated_at: string;
  sources: LogFileStats[];
  window: { from: string | null; to: string | null };
  filters: { since: string | null; until: string | null; bot: string | null };
  totals: {
    lines: number;
    parsed: number;
    unparsed: number;
    /** parsed hits outside --since/--until */
    outsideWindow: number;
    /** hits whose UA matched any registry bot (spoofed ones excluded) */
    botHits: number;
    aiBotHits: number;
    searchBotHits: number;
    verified: number;
    unverified: number;
    spoofed: number;
    /** AI-bot 5xx and blocks: the two numbers the alert rule reads */
    aiErrors: number;
    aiBlocked: number;
    formats: Partial<Record<LogFormat, number>>;
  };
  ipVerification: {
    mode: "off" | "on";
    sources: RangeSource[];
    note: string;
  };
  bots: BotRow[];
  byPurpose: Record<BotPurpose, number>;
  daily: { date: string; bots: Record<string, number> }[];
  pages: PageRow[];
  /** distinct paths beyond MAX_PATHS, counted but not tracked */
  otherPaths: number;
  problems: ProblemRow[];
  spoofed: SpoofRow[];
  /** robots.txt-only tokens: they never appear in a log, said once */
  robotsOnly: { id: string; label: string; note: string }[];
  join: CrawlerJoin | null;
  /** AI referral visits (added in 0.2.0; absent in reports written before it,
   *  which readers show as "not counted", never as zero) */
  referrals?: ReferralSummary;
  privacy: { ipsRedacted: boolean; queryStringsDropped: true };
}

/* ------------------------------- redaction -------------------------------- */

export function redactIp(ip: string): string {
  if (isIPv4(ip)) return `${ip.split(".").slice(0, 2).join(".")}.x.x`;
  if (isIPv6(ip)) {
    const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : null;
    if (v4 && isIPv4(v4)) return redactIp(v4);
    return `${ip.split(":").slice(0, 2).join(":")}::x`;
  }
  return "x";
}

const QUERY = /(\/[^\s"?#]*)\?[^\s"]*/g;

/** The receipt form of a log line: client IP redacted (unless keepIp), query
 *  strings cut, length capped. */
export function receiptLine(hit: AccessHit, keepIp = false): string {
  let s = hit.raw.length > 2000 ? `${hit.raw.slice(0, 2000)}…` : hit.raw;
  s = s.replace(QUERY, "$1?…");
  if (hit.ip && !keepIp) s = s.split(hit.ip).join(redactIp(hit.ip));
  return s;
}

/* ------------------------------- aggregator ------------------------------- */

const emptyStatus = (): StatusCounts => ({ "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 });
const bucket = (s: number | null): keyof StatusCounts =>
  s === null ? "other" : s >= 200 && s < 300 ? "2xx" : s >= 300 && s < 400 ? "3xx" : s >= 400 && s < 500 ? "4xx" : s >= 500 && s < 600 ? "5xx" : "other";

export function problemKind(status: number | null, waf: AccessHit["waf"]): ProblemKind | null {
  if (waf) return "blocked";
  if (status === null) return null;
  if (status === 401 || status === 403 || status === 429) return "blocked";
  if (status >= 500 && status < 600) return "error";
  if (status === 404 || status === 410) return "not_found";
  if (status >= 400 && status < 500) return "client_error";
  return null;
}

interface ReferralAcc {
  assistant: AiAssistant;
  visits: number;
  viaReferrer: number;
  viaUtmSource: number;
  paths: Map<string, number>;
  first: string | null;
  last: string | null;
  receipts: string[];
}

interface BotAcc {
  bot: AiBot;
  hits: number;
  paths: Map<string, number>;
  status: StatusCounts;
  blocked: number;
  errors: number;
  notFound: number;
  first: string | null;
  last: string | null;
  verified: number;
  unverified: number;
}

export interface CrawlerAnalyticsOptions {
  extraBots?: ExtraBot[] | null;
  /** IP ranges per bot id (bot-ip-ranges.ts loadBotRanges); null = verification off */
  ranges?: Map<string, RangeSet> | null;
  rangeSources?: RangeSource[];
  includeIps?: boolean;
  since?: string | null;
  until?: string | null;
  /** only this bot id */
  bot?: string | null;
  now?: Date;
}

export interface JoinRun {
  runId: string;
  brandDomain: string;
  answers: { qid: string; engine: string; ok?: boolean | null; citations?: { url: string }[] | null }[];
  corpus?: { url: string; final_url?: string | null }[];
}

const hostOf = (u: string): string | null => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};
const pathKey = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") || "/" : p);

export class CrawlerAnalytics {
  private match;
  private registry: AiBot[];
  private salt = randomBytes(16);
  private bots = new Map<string, BotAcc>();
  private pages = new Map<string, PageRow>();
  private otherPaths = new Set<string>();
  private otherPathsCount = 0;
  private problems = new Map<string, ProblemRow>();
  private spoofs = new Map<string, SpoofRow>();
  private daily = new Map<string, Record<string, number>>();
  private referrals = new Map<string, ReferralAcc>();
  private files: LogFileStats[] = [];
  private t = {
    parsed: 0,
    outsideWindow: 0,
    botHits: 0,
    aiBotHits: 0,
    searchBotHits: 0,
    verified: 0,
    unverified: 0,
    spoofed: 0,
    aiErrors: 0,
    aiBlocked: 0,
  };
  private from: string | null = null;
  private to: string | null = null;
  private sinceMs: number | null;
  private untilMs: number | null;

  constructor(private opts: CrawlerAnalyticsOptions = {}) {
    this.registry = botRegistry(opts.extraBots);
    this.match = makeBotMatcher(this.registry);
    this.sinceMs = opts.since ? Date.parse(opts.since) : null;
    // a bare date for --until means the whole of that day
    this.untilMs = opts.until ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(opts.until) ? `${opts.until}T23:59:59.999Z` : opts.until) : null;
  }

  /** per-file counts from readAccessLog's onFile */
  addFile(s: LogFileStats) {
    this.files.push(s);
  }

  ipKey(ip: string): string {
    return createHmac("sha256", this.salt).update(ip).digest("hex").slice(0, 10);
  }

  add(hit: AccessHit) {
    this.t.parsed += 1;
    if (hit.time && (this.sinceMs !== null || this.untilMs !== null)) {
      const ms = Date.parse(hit.time);
      if ((this.sinceMs !== null && ms < this.sinceMs) || (this.untilMs !== null && ms > this.untilMs)) {
        this.t.outsideWindow += 1;
        return;
      }
    }
    if (hit.time) {
      if (!this.from || hit.time < this.from) this.from = hit.time;
      if (!this.to || hit.time > this.to) this.to = hit.time;
    }
    const bot = this.match(hit.userAgent);
    if (!bot) {
      this.addReferral(hit);
      return;
    }
    if (this.opts.bot && bot.id !== this.opts.bot) return;
    const keep = !!this.opts.includeIps;

    const v = verifyIp(bot, hit.ip, this.opts.ranges ?? null);
    if (v === "spoofed") {
      this.t.spoofed += 1;
      const ip = hit.ip ?? "";
      const key = `${bot.id}|${this.ipKey(ip)}`;
      const row = this.spoofs.get(key) ?? { bot: bot.id, botLabel: bot.label, ip: keep ? ip : redactIp(ip), hits: 0, receipts: [] };
      row.hits += 1;
      if (row.receipts.length < 2) row.receipts.push(receiptLine(hit, keep));
      this.spoofs.set(key, row);
      return;
    }
    if (v === "verified") this.t.verified += 1;
    else this.t.unverified += 1;
    this.t.botHits += 1;
    if (bot.ai) this.t.aiBotHits += 1;
    if (bot.id === "googlebot" || bot.id === "bingbot") this.t.searchBotHits += 1;

    const acc =
      this.bots.get(bot.id) ??
      ({ bot, hits: 0, paths: new Map(), status: emptyStatus(), blocked: 0, errors: 0, notFound: 0, first: null, last: null, verified: 0, unverified: 0 } as BotAcc);
    acc.hits += 1;
    acc.status[bucket(hit.status)] += 1;
    if (v === "verified") acc.verified += 1;
    else acc.unverified += 1;
    if (hit.time) {
      if (!acc.first || hit.time < acc.first) acc.first = hit.time;
      if (!acc.last || hit.time > acc.last) acc.last = hit.time;
      const day = hit.time.slice(0, 10);
      const d = this.daily.get(day) ?? {};
      d[bot.id] = (d[bot.id] ?? 0) + 1;
      this.daily.set(day, d);
    }
    const kind = problemKind(hit.status, hit.waf);
    if (kind === "blocked") acc.blocked += 1;
    if (kind === "error") acc.errors += 1;
    if (kind === "not_found") acc.notFound += 1;
    if (bot.ai && kind === "blocked") this.t.aiBlocked += 1;
    if (bot.ai && kind === "error") this.t.aiErrors += 1;
    this.bots.set(bot.id, acc);

    const p = pathKey(hit.path);
    const tracked = this.pages.has(p) || this.pages.size < MAX_PATHS;
    if (tracked) {
      if (acc.paths.has(p) || acc.paths.size < MAX_PATHS) acc.paths.set(p, (acc.paths.get(p) ?? 0) + 1);
      const page = this.pages.get(p) ?? { path: p, hits: 0, bots: {}, status: emptyStatus(), lastSeen: null };
      page.hits += 1;
      page.bots[bot.id] = (page.bots[bot.id] ?? 0) + 1;
      page.status[bucket(hit.status)] += 1;
      if (hit.time && (!page.lastSeen || hit.time > page.lastSeen)) page.lastSeen = hit.time;
      this.pages.set(p, page);
    } else if (this.otherPaths.size < 100_000 && !this.otherPaths.has(p)) {
      this.otherPaths.add(p);
      this.otherPathsCount += 1;
    }

    if (kind) {
      const key = `${p}|${bot.id}|${kind}`;
      if (this.problems.has(key) || this.problems.size < 20_000) {
        const row = this.problems.get(key) ?? { path: p, bot: bot.id, botLabel: bot.label, kind, statuses: {}, count: 0, receipts: [] };
        row.count += 1;
        const code = hit.status === null ? "waf" : String(hit.status);
        row.statuses[code] = (row.statuses[code] ?? 0) + 1;
        if (row.receipts.length < RECEIPTS_PER_ROW) row.receipts.push(receiptLine(hit, keep));
        this.problems.set(key, row);
      }
    }
  }

  /** A request from a browser: count it when an AI assistant sent it. */
  private addReferral(hit: AccessHit) {
    const ref = aiReferral(hit.refererHost ?? null, hit.utmSource ?? null);
    if (!ref) return;
    const acc =
      this.referrals.get(ref.assistant.id) ??
      ({ assistant: ref.assistant, visits: 0, viaReferrer: 0, viaUtmSource: 0, paths: new Map(), first: null, last: null, receipts: [] } as ReferralAcc);
    acc.visits += 1;
    if (ref.via === "referrer") acc.viaReferrer += 1;
    else acc.viaUtmSource += 1;
    const p = pathKey(hit.path);
    if (acc.paths.has(p) || acc.paths.size < MAX_PAGES) acc.paths.set(p, (acc.paths.get(p) ?? 0) + 1);
    if (hit.time) {
      if (!acc.first || hit.time < acc.first) acc.first = hit.time;
      if (!acc.last || hit.time > acc.last) acc.last = hit.time;
    }
    if (acc.receipts.length < RECEIPTS_PER_ROW) acc.receipts.push(receiptLine(hit, !!this.opts.includeIps));
    this.referrals.set(ref.assistant.id, acc);
  }

  private referralSummary(): ReferralSummary {
    const assistants: ReferralRow[] = [...this.referrals.values()]
      .map((a) => ({
        id: a.assistant.id,
        label: a.assistant.label,
        operator: a.assistant.operator,
        visits: a.visits,
        viaReferrer: a.viaReferrer,
        viaUtmSource: a.viaUtmSource,
        pages: [...a.paths.entries()]
          .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
          .slice(0, 10)
          .map(([path, visits]) => ({ path, visits })),
        firstSeen: a.first,
        lastSeen: a.last,
        receipts: a.receipts,
      }))
      .sort((a, b) => b.visits - a.visits || a.label.localeCompare(b.label));
    return {
      visits: assistants.reduce((n, a) => n + a.visits, 0),
      assistants,
      listChecked: AI_REFERRERS_CHECKED,
      note: REFERRALS_NOTE,
    };
  }

  finish(opts: { run?: JoinRun | null; lines?: number } = {}): CrawlerReport {
    const formats: Partial<Record<LogFormat, number>> = {};
    let lines = 0;
    let skipped = 0;
    for (const f of this.files) {
      lines += f.lines;
      skipped += f.skipped;
      for (const [k, n] of Object.entries(f.formats)) formats[k as LogFormat] = (formats[k as LogFormat] ?? 0) + (n ?? 0);
    }
    if (this.files.length === 0) lines = opts.lines ?? this.t.parsed;

    const bots: BotRow[] = [...this.bots.values()]
      .map((a) => ({
        id: a.bot.id,
        label: a.bot.label,
        operator: a.bot.operator,
        purpose: a.bot.purpose,
        ai: a.bot.ai,
        registryVerified: a.bot.verified,
        docsUrl: a.bot.docsUrl,
        hits: a.hits,
        distinctPages: a.paths.size,
        status: a.status,
        blocked: a.blocked,
        errors: a.errors,
        notFound: a.notFound,
        firstSeen: a.first,
        lastSeen: a.last,
        verification: { verified: a.verified, unverified: a.unverified },
        topPages: [...a.paths.entries()]
          .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
          .slice(0, 10)
          .map(([path, hits]) => ({ path, hits })),
      }))
      .sort((a, b) => Number(b.ai) - Number(a.ai) || b.hits - a.hits || a.label.localeCompare(b.label));

    const byPurpose = { training: 0, search: 0, user: 0, robots_only: 0, other: 0 } as Record<BotPurpose, number>;
    for (const b of bots) byPurpose[b.purpose] += b.hits;

    const aiIds = new Set(this.registry.filter((b) => b.ai).map((b) => b.id));
    const aiHitsOf = (p: PageRow) => Object.entries(p.bots).reduce((s, [id, n]) => s + (aiIds.has(id) ? n : 0), 0);
    const pages = [...this.pages.values()]
      .sort((a, b) => aiHitsOf(b) - aiHitsOf(a) || b.hits - a.hits || a.path.localeCompare(b.path))
      .slice(0, MAX_PAGES);

    const KIND_RANK: Record<ProblemKind, number> = { blocked: 0, error: 1, not_found: 2, client_error: 3 };
    const problems = [...this.problems.values()]
      .sort((a, b) => b.count - a.count || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.path.localeCompare(b.path))
      .slice(0, MAX_PROBLEMS);

    const verifying = !!this.opts.ranges;
    const unavailable = (this.opts.rangeSources ?? []).filter((s) => s.source === "unavailable").length;
    const stale = (this.opts.rangeSources ?? []).filter((s) => s.source === "stale");
    const note = !verifying
      ? "IP verification is off: every bot hit is unverified (its user agent is a claim). Run with --verify-ips to check IPs against the operators' published ranges."
      : `IPs were checked against the operators' published ranges.${stale.length ? ` ${stale.length} range file${stale.length === 1 ? " was" : "s were"} unreachable, so the cached copy from ${stale.map((s) => s.fetchedAt?.slice(0, 10)).join(", ")} was used.` : ""}${unavailable ? ` ${unavailable} range file${unavailable === 1 ? " was" : "s were"} unavailable; those bots stay unverified.` : ""} Bots that publish no ranges stay unverified.`;

    const report: CrawlerReport = {
      schema_version: CRAWLER_REPORT_SCHEMA_VERSION,
      generated_at: (this.opts.now ?? new Date()).toISOString(),
      sources: this.files,
      window: { from: this.from, to: this.to },
      filters: { since: this.opts.since ?? null, until: this.opts.until ?? null, bot: this.opts.bot ?? null },
      totals: { lines, parsed: this.t.parsed, unparsed: skipped, ...this.tWithoutParsed(), formats },
      ipVerification: { mode: verifying ? "on" : "off", sources: this.opts.rangeSources ?? [], note },
      bots,
      byPurpose,
      daily: [...this.daily.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, b]) => ({ date, bots: b })),
      pages,
      otherPaths: this.otherPathsCount,
      problems,
      spoofed: [...this.spoofs.values()].sort((a, b) => b.hits - a.hits).slice(0, 50),
      robotsOnly: this.registry
        .filter((b) => b.purpose === "robots_only")
        .map((b) => ({ id: b.id, label: b.label, note: b.note ?? "" })),
      join: opts.run ? this.join(opts.run, aiIds) : null,
      referrals: this.referralSummary(),
      privacy: { ipsRedacted: !this.opts.includeIps, queryStringsDropped: true },
    };
    return report;
  }

  private tWithoutParsed() {
    const t = this.t;
    return {
      outsideWindow: t.outsideWindow,
      botHits: t.botHits,
      aiBotHits: t.aiBotHits,
      searchBotHits: t.searchBotHits,
      verified: t.verified,
      unverified: t.unverified,
      spoofed: t.spoofed,
      aiErrors: t.aiErrors,
      aiBlocked: t.aiBlocked,
    };
  }

  private join(run: JoinRun, aiIds: Set<string>): CrawlerJoin {
    const domain = run.brandDomain.toLowerCase().replace(/^www\./, "");
    const own = (u: string) => {
      const h = hostOf(u);
      return !!h && (h === domain || h.endsWith(`.${domain}`));
    };
    const toPath = (u: string) => {
      try {
        return pathKey(new URL(u).pathname || "/");
      } catch {
        return "/";
      }
    };
    const cited = new Map<string, CitedPageRow>();
    for (const a of run.answers) {
      if (a.ok === false) continue;
      for (const c of a.citations ?? []) {
        if (!c?.url || !own(c.url)) continue;
        const p = toPath(c.url);
        const row = cited.get(p) ?? { url: c.url, path: p, engines: [], answers: [], aiBotHits: 0, bots: {}, operatorFetched: {}, problems: 0 };
        if (!row.engines.includes(a.engine)) row.engines.push(a.engine);
        if (row.answers.length < 5 && !row.answers.some((x) => x.qid === a.qid && x.engine === a.engine)) row.answers.push({ qid: a.qid, engine: a.engine });
        cited.set(p, row);
      }
    }
    const opOf = new Map(this.registry.map((b) => [b.id, b.operator] as const));
    for (const row of cited.values()) {
      const page = this.pages.get(row.path);
      for (const [id, n] of Object.entries(page?.bots ?? {})) {
        if (!aiIds.has(id) && id !== "googlebot" && id !== "bingbot") continue;
        row.bots[id] = n;
        if (aiIds.has(id)) row.aiBotHits += n;
      }
      for (const e of row.engines) {
        const op = ENGINE_OPERATOR[e];
        row.operatorFetched[e] = !!op && Object.keys(row.bots).some((id) => opOf.get(id) === op);
      }
      for (const pr of this.problems.values()) if (pr.path === row.path && aiIds.has(pr.bot)) row.problems += pr.count;
    }
    const rows = [...cited.values()].sort((a, b) => b.answers.length - a.answers.length || a.path.localeCompare(b.path));
    const readNotFetched = new Set<string>();
    for (const p of run.corpus ?? []) {
      const u = p.final_url ?? p.url;
      if (!own(u)) continue;
      const path = toPath(u);
      const page = this.pages.get(path);
      const ai = page ? Object.entries(page.bots).some(([id]) => aiIds.has(id)) : false;
      if (!ai) readNotFetched.add(path);
    }
    return {
      runId: run.runId,
      brandDomain: domain,
      cited: rows,
      citedNotFetched: rows.filter((r) => r.aiBotHits === 0).map((r) => r.path),
      citedWithProblems: rows.filter((r) => r.problems > 0).map((r) => r.path),
      readNotFetched: [...readNotFetched].sort(),
      note: `Compared with the log window ${this.from?.slice(0, 10) ?? "?"} to ${this.to?.slice(0, 10) ?? "?"}. A page no AI bot fetched in this window may have been fetched before it; this is not a cause of any answer.`,
    };
  }
}

export { PURPOSE_LABEL };

/** One call: stream a file, directory or Readable through the aggregator,
 *  optionally verifying IPs first (the only network use: GET the operators'
 *  public range files, cached in cacheDir). */
export async function analyzeAccessLogs(
  source: string | Readable,
  opts: Omit<CrawlerAnalyticsOptions, "ranges" | "rangeSources"> & {
    verifyIps?: boolean;
    cacheDir?: string | null;
    fetch?: RangeFetch;
    run?: JoinRun | null;
    onLine?: (n: number) => void;
  } = {},
): Promise<CrawlerReport> {
  let ranges: Map<string, RangeSet> | null = null;
  let rangeSources: RangeSource[] = [];
  if (opts.verifyIps) {
    const loaded = await loadBotRanges(botRegistry(opts.extraBots), { cacheDir: opts.cacheDir, fetch: opts.fetch, now: opts.now });
    ranges = loaded.ranges;
    rangeSources = loaded.sources;
  }
  const agg = new CrawlerAnalytics({ ...opts, ranges, rangeSources });
  for await (const hit of readAccessLog(source, { onFile: (s) => agg.addFile(s), onLine: opts.onLine })) agg.add(hit);
  return agg.finish({ run: opts.run ?? null });
}

/** The two numbers the alert rule reads, from a finished report. */
export function crawlerAlertWindow(r: CrawlerReport) {
  return { from: r.window.from, to: r.window.to, aiBotHits: r.totals.aiBotHits, errors: r.totals.aiErrors, blocked: r.totals.aiBlocked };
}
