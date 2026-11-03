// Is this request really from the bot its User-Agent claims? OpenAI,
// Anthropic, Perplexity, Google, Microsoft, Apple, Common Crawl, DuckDuckGo and
// Mistral publish the IP ranges their crawlers use, as JSON files of the shape
//   {"creationTime": "...", "prefixes": [{"ipv4Prefix": "a.b.c.d/n"} | {"ipv6Prefix": "..."}]}
// (Common Crawl adds `synctoken` and `notes`; checked 2026-11-02). The URLs live
// in the registry (ai-bots.ts).
//
// Verification is opt-in (`saylent crawlers --verify-ips`): it is the only part
// of crawler analytics that touches the network, and all it does is GET those
// public files. Nothing about your logs is sent anywhere. Files are cached for
// 24 hours; on a failed fetch the stale cache is used and its date is reported;
// with neither, the bot's hits stay "unverified", never "verified".
//
//   verified    the IP is inside the operator's published ranges
//   spoofed     the operator publishes ranges and the IP is outside them
//   unverified  no ranges (none published, verification off, or unavailable)
import { BlockList, isIPv4, isIPv6 } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { AiBot } from "./ai-bots";

export type IpVerdict = "verified" | "spoofed" | "unverified";

export interface RangeSource {
  url: string;
  /** "live" fetched now, "cache" fresh cache, "stale" old cache after a failed
   *  fetch, "unavailable" nothing usable */
  source: "live" | "cache" | "stale" | "unavailable";
  fetchedAt: string | null;
  prefixes: number;
  error?: string;
}

export interface ParsedRanges {
  creationTime: string | null;
  v4: string[];
  v6: string[];
}

/** Parse one published range file. Bare IPs (no "/n") are taken as /32 or /128. */
export function parseRangeFile(json: unknown): ParsedRanges {
  const o = (json ?? {}) as { creationTime?: unknown; prefixes?: unknown };
  const out: ParsedRanges = { creationTime: typeof o.creationTime === "string" ? o.creationTime : null, v4: [], v6: [] };
  if (!Array.isArray(o.prefixes)) throw new Error("no prefixes array");
  for (const p of o.prefixes as Record<string, unknown>[]) {
    const v4 = typeof p?.ipv4Prefix === "string" ? p.ipv4Prefix.trim() : null;
    const v6 = typeof p?.ipv6Prefix === "string" ? p.ipv6Prefix.trim() : null;
    if (v4) out.v4.push(v4.includes("/") ? v4 : `${v4}/32`);
    if (v6) out.v6.push(v6.includes("/") ? v6 : `${v6}/128`);
  }
  return out;
}

export class RangeSet {
  private list = new BlockList();
  size = 0;
  add(r: ParsedRanges) {
    for (const c of r.v4) this.addCidr(c, "ipv4");
    for (const c of r.v6) this.addCidr(c, "ipv6");
  }
  private addCidr(cidr: string, type: "ipv4" | "ipv6") {
    const [net, bits] = cidr.split("/");
    const n = Number(bits);
    if (!Number.isInteger(n)) return;
    if (type === "ipv4" ? !isIPv4(net) : !isIPv6(net)) return;
    try {
      this.list.addSubnet(net, n, type);
      this.size += 1;
    } catch {
      /* a malformed prefix in a published file is skipped, not fatal */
    }
  }
  has(ip: string): boolean {
    const clean = ip.startsWith("::ffff:") && isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
    if (isIPv4(clean)) return this.list.check(clean, "ipv4");
    if (isIPv6(clean)) return this.list.check(clean, "ipv6");
    return false;
  }
}

export type RangeFetch = (url: string) => Promise<unknown>;

const defaultFetch: RangeFetch = async (url) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // some operators serve these as application/octet-stream: parse the text
    return JSON.parse(await res.text()) as unknown;
  } finally {
    clearTimeout(t);
  }
};

export const CACHE_TTL_MS = 24 * 3_600_000;

/** Fetch (or read from cache) the range files for a set of bots, per operator.
 *  `fetchRanges: false` reads nothing and verifies nothing. */
export async function loadBotRanges(
  bots: readonly AiBot[],
  opts: { cacheDir?: string | null; fetch?: RangeFetch; now?: Date; offline?: boolean } = {},
): Promise<{ ranges: Map<string, RangeSet>; sources: RangeSource[] }> {
  const now = (opts.now ?? new Date()).getTime();
  const fetchImpl = opts.fetch ?? defaultFetch;
  const urls = [...new Set(bots.flatMap((b) => b.ipRanges ?? []))];
  const parsed = new Map<string, ParsedRanges | null>();
  const sources: RangeSource[] = [];
  for (const url of urls) {
    const file = opts.cacheDir ? path.join(opts.cacheDir, `${createHash("sha256").update(url).digest("hex").slice(0, 16)}.json`) : null;
    let cached: { fetchedAt: string; body: unknown } | null = null;
    if (file && existsSync(file)) {
      try {
        cached = JSON.parse(readFileSync(file, "utf8")) as { fetchedAt: string; body: unknown };
      } catch {
        cached = null;
      }
    }
    const fresh = cached && now - Date.parse(cached.fetchedAt) < CACHE_TTL_MS;
    if (cached && fresh) {
      try {
        const r = parseRangeFile(cached.body);
        parsed.set(url, r);
        sources.push({ url, source: "cache", fetchedAt: cached.fetchedAt, prefixes: r.v4.length + r.v6.length });
        continue;
      } catch {
        /* fall through to a refetch */
      }
    }
    let error: string | undefined;
    if (!opts.offline) {
      try {
        const body = await fetchImpl(url);
        const r = parseRangeFile(body);
        parsed.set(url, r);
        const fetchedAt = new Date(now).toISOString();
        sources.push({ url, source: "live", fetchedAt, prefixes: r.v4.length + r.v6.length });
        if (file) {
          mkdirSync(path.dirname(file), { recursive: true });
          writeFileSync(file, JSON.stringify({ url, fetchedAt, body }));
        }
        continue;
      } catch (e) {
        error = e instanceof Error ? e.message.slice(0, 120) : "fetch failed";
      }
    } else {
      error = "offline";
    }
    if (cached) {
      try {
        const r = parseRangeFile(cached.body);
        parsed.set(url, r);
        sources.push({ url, source: "stale", fetchedAt: cached.fetchedAt, prefixes: r.v4.length + r.v6.length, error });
        continue;
      } catch {
        /* unusable cache */
      }
    }
    parsed.set(url, null);
    sources.push({ url, source: "unavailable", fetchedAt: null, prefixes: 0, error });
  }
  // A bot is checkable only when EVERY one of its files loaded: a partial list
  // would call real crawler IPs spoofed.
  const ranges = new Map<string, RangeSet>();
  for (const b of bots) {
    if (!b.ipRanges?.length) continue;
    const files = b.ipRanges.map((u) => parsed.get(u));
    if (files.some((f) => !f)) continue;
    const set = new RangeSet();
    for (const f of files) set.add(f!);
    ranges.set(b.id, set);
  }
  return { ranges, sources };
}

export function verifyIp(bot: AiBot, ip: string | null, ranges: Map<string, RangeSet> | null): IpVerdict {
  if (!ranges || !ip) return "unverified";
  const set = ranges.get(bot.id);
  if (!set || set.size === 0) return "unverified";
  return set.has(ip) ? "verified" : "spoofed";
}
