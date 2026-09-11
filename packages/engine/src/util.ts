// URL normalization + the crawler's fetch discipline. See METHODOLOGY.md for
// the alias/robots mechanics and the fetch-safety rules. Pure functions,
// unit-tested in util.test.ts.
import * as cheerio from "cheerio";
// Pure data, not a Node-core import — safe wherever this module ends up
// (util.ts is transitively reachable from client components, see the
// dynamic node:dns/promises import further down for why that matters here).
import engineManifest from "../package.json";

/** The page a site owner lands on when they look up the crawler that just
 *  fetched them: what it is, what it fetches, and how to block it. It is the
 *  "+<contact url>" every legitimate crawler's UA carries, so it must be a
 *  live page — a 404 here reads as a bot hiding. */
export const CRAWLER_DOCS_URL = "https://yotambraun.github.io/saylent/docs/crawler";

/** Default crawler user agent: `<name>/<version> (+<contact url>)`, overridable
 *  wholesale via SAYLENT_USER_AGENT (or saylent.config.ts `userAgent`) so a
 *  self-hosted deployment identifies itself, not us. */
export function defaultUserAgent(): string {
  const version = (engineManifest as { version?: string }).version ?? "0.0.0";
  return (
    process.env.SAYLENT_USER_AGENT ||
    `Mozilla/5.0 (compatible; SaylentAudit/${version}; +${CRAWLER_DOCS_URL})`
  );
}

/** URL normalization (see METHODOLOGY.md) — lowercase scheme+host, strip fragment, strip the tracking params
 *  (utm_ prefix, ref, fbclid, gclid), strip trailing slash keeping root.
 *  Returns input unchanged if unparseable. */
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
  // strip trailing slash unless it's the root path
  if (out.endsWith("/") && parsed.pathname !== "/") out = out.slice(0, -1);
  if (parsed.pathname === "/" && !parsed.search) {
    // keep root as scheme://host/ per "keep '/' root"
    out = `${parsed.protocol}//${parsed.host}/`;
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word alias presence (see METHODOLOGY.md): (?<![A-Za-z0-9])ALIAS(?![A-Za-z0-9]),
 *  case-insensitive. MUST NOT match substrings ("Acme" ≠ "Acmeology"). */
export function wordPresent(needle: string, haystack: string): boolean {
  if (!needle.trim()) return false;
  return new RegExp(`(?<![A-Za-z0-9])${escapeRe(needle)}(?![A-Za-z0-9])`, "i").test(haystack);
}

/** Excerpt = ±160 chars around the first whole-word match ("" if absent). */
export function contextExcerpt(needle: string, text: string, radius = 160): string {
  const m = new RegExp(`(?<![A-Za-z0-9])${escapeRe(needle)}(?![A-Za-z0-9])`, "i").exec(text);
  if (!m) return "";
  const start = Math.max(0, m.index - radius);
  const end = Math.min(text.length, m.index + m[0].length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/** Strip ```fences, else first {...} block, else {}. Never throws. */
export function parseJsonLoosely(raw: string): Record<string, unknown> {
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s);
      return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw.trim());
  if (direct) return direct;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fence) {
    const fenced = tryParse(fence[1].trim());
    if (fenced) return fenced;
  }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) {
    const block = tryParse(raw.slice(first, last + 1));
    if (block) return block;
  }
  return {};
}

/** cheerio text extraction, script/style/noscript/svg removed. */
export function stripHtmlToText(html: string, limit = 40000): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();
  return $("body").text().replace(/\s+/g, " ").trim().slice(0, limit);
}

// the ORIGINAL loose prefix set, unchanged, so a
// hostname-shaped string ("10.foo.internal") keeps being refused exactly as
// before. The ranges added by #13 live in EXTRA_PRIVATE_V4 and are applied to
// dotted-quad LITERALS only, so a legitimate numeric domain name is not newly
// blocked by them.
const PRIVATE_IP =
  /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)|^(\[?::1\]?|localhost)$/i;

/** reserved/non-routable IPv4 ranges the original guard missed:
 *  100.64.0.0/10 (CGNAT — reaches carrier-internal hosts), 192.0.0.0/24
 *  (IETF protocol assignments, incl. 192.0.0.170 NAT64 discovery),
 *  198.18.0.0/15 (benchmarking), 224.0.0.0/4 (multicast) and 240.0.0.0/4
 *  (reserved, which subsumes 255.255.255.255 broadcast). */
const EXTRA_PRIVATE_V4 =
  /^(100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|192\.0\.0\.|198\.1[89]\.|(22[4-9]|23\d|24\d|25[0-5])\.)/;

const IPV4_SHAPE = /^\d{1,3}(\.\d{1,3}){3}$/;

function isPrivateV4(addr: string): boolean {
  return PRIVATE_IP.test(addr) || EXTRA_PRIVATE_V4.test(addr);
}

/** Expand any IPv6 text form (compressed `::`, or with a trailing dotted-quad)
 *  into its 8 hextets. null when the literal is not parseable — callers treat
 *  that as "not safe" rather than "public". */
function parseIpv6(input: string): number[] | null {
  let text = input;
  const dotted = /^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(text);
  if (dotted) {
    const o = dotted[2].split(".").map(Number);
    if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    text = `${dotted[1]}${(((o[0] << 8) | o[1]) >>> 0).toString(16)}:${(((o[2] << 8) | o[3]) >>> 0).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const split = (x: string) => (x === "" ? [] : x.split(":"));
  const head = split(halves[0]);
  const tail = halves.length === 2 ? split(halves[1]) : [];
  let parts: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    parts = [...head, ...Array<string>(fill).fill("0"), ...tail];
  } else {
    parts = head;
  }
  if (parts.length !== 8) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
    out.push(parseInt(p, 16));
  }
  return out;
}

const v4FromHextets = (a: number, b: number): string =>
  `${(a >> 8) & 0xff}.${a & 0xff}.${(b >> 8) & 0xff}.${b & 0xff}`;

/** SEC-HARDEN — a RESOLVED address literal (dotted-quad IPv4 or IPv6, brackets
 *  stripped) that falls in a private/loopback/link-local/reserved range. Used
 *  post-DNS in safeFetch and for IPv6 host literals (v4 goes through PRIVATE_IP).
 *
 * IPv6 is judged on its EXPANDED hextets, not a text prefix, so the
 *  hex-embedded forms of an IPv4-mapped address (`::ffff:7f00:1`, the same
 *  address a text-only `::ffff:127.0.0.1` check misses) and NAT64
 *  (`64:ff9b::/96`, which a resolver hands back for a v4 target) both get the
 *  embedded v4 extracted and re-checked. */
export function isPrivateIp(ip: string): boolean {
  const addr = ip.trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (IPV4_SHAPE.test(addr)) return isPrivateV4(addr);
  if (addr.includes(":")) {
    const h = parseIpv6(addr);
    if (!h) return true; // unparseable IPv6 literal: fail closed
    const topZero = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0;
    // ::/128 unspecified and ::1/128 loopback
    if (topZero && h[5] === 0 && h[6] === 0 && h[7] <= 1) return true;
    // ::ffff:a.b.c.d and its hex spelling ::ffff:xxxx:xxxx (v4-mapped), plus
    // the deprecated ::a.b.c.d v4-compatible form — judge the embedded v4.
    if (topZero && (h[5] === 0xffff || h[5] === 0)) return isPrivateV4(v4FromHextets(h[6], h[7]));
    // NAT64 well-known prefix 64:ff9b::/96 — judge the embedded v4.
    if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
      return isPrivateV4(v4FromHextets(h[6], h[7]));
    }
    if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    return false;
  }
  return false;
}

/** An obfuscated/encoded IPv4 host (decimal 2130706433, hex 0x7f000001, octal
 *  0177.0.0.1) — a classic SSRF bypass that skips a dotted-quad string check.
 *  We refuse ALL of them: a legitimate crawl target is a hostname or a plain
 *  dotted-decimal IP, never an integer/hex/leading-zero form. */
function isEncodedIpv4(host: string): boolean {
  if (/^0x[0-9a-f]+$/i.test(host)) return true; // whole hex
  if (/^\d+$/.test(host)) return true; // whole decimal (e.g. 2130706433)
  if (host.includes(".") && /^[0-9a-fx.]+$/i.test(host)) {
    return host.split(".").some((p) => /^0x/i.test(p) || (p.length > 1 && p.startsWith("0")));
  }
  return false;
}

/** SSRF pre-resolution guard: true if `hostname` is a
 *  private/internal IP literal, localhost, a private IPv6 literal, or an encoded
 *  IPv4 evasion form. Shared by safeFetch and the onboarding preflight so both
 *  reject the same set. This is the LITERAL check; safeFetch additionally
 *  DNS-resolves and re-checks each hop's address (a hostname resolving into a
 *  private range — DNS rebinding — is caught there, not here). */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return true;
  // a full dotted-quad literal is judged by isPrivateIp (which knows
  // the CGNAT/multicast/reserved ranges); everything else keeps the original
  // loose prefix + encoded-form checks byte for byte.
  if (IPV4_SHAPE.test(host)) return isPrivateIp(host);
  if (PRIVATE_IP.test(host)) return true;
  if (host.includes(":")) return isPrivateIp(host); // IPv6 literal: block only private/reserved
  return isEncodedIpv4(host);
}

export interface SafeFetchResult {
  status: number;
  finalUrl: string;
  text: string;
}

/** Injectable DNS resolver (all addresses). Real dns.promises.lookup in prod;
 *  tests pass a stub to exercise the DNS-rebind guard without touching the network. */
export type HostLookup = (hostname: string) => Promise<{ address: string }[]>;
// Lazy import: node:dns/promises is Node-only, and util.ts is transitively reachable
// from client components (dossier.tsx → source-map.ts imports the pure helpers here),
// so a static import would fail the client bundle. The dynamic import stays out of
// the client graph and only loads on the server, where safeFetch actually runs.
const defaultLookup: HostLookup = async (hostname) => {
  const { lookup } = await import("node:dns/promises");
  return lookup(hostname, { all: true });
};

// ---------------------------------------------------------------------------
// pin the vetted address (TOCTOU / late-rebind defense).
//
// safeFetch used to resolve a hostname, check every address, and then hand the
// URL to fetch(), which resolves it AGAIN. Between those two resolutions an
// attacker-controlled DNS answer can flip from a public address to 169.254.169.254
// — the check passes, the connection lands inside the network. The fix routes
// the guarded fetch through an undici Agent whose socket-level `connect.lookup`
// (a) re-resolves through the SAME injected resolver that was validated, (b)
// intersects the answer with the addresses vetted for that hostname moments
// earlier, and (c) re-applies isPrivateIp. Anything else fails the connection
// closed, before a packet leaves.
//
// LIMITS (documented deliberately): undici reaches this module as cheerio's own
// dependency rather than a declared one, and the import is deliberately opaque
// to bundlers (util.ts is transitively reachable from client components — the
// same reason node:dns/promises is imported dynamically below). When it cannot
// be loaded the fetch still runs, with every pre-DNS and post-DNS guard intact
// and only the pinning lost.
// ---------------------------------------------------------------------------

interface VettedEntry {
  addresses: string[];
  allowPrivate: boolean;
  lookup: HostLookup;
}

/** hostname (lowercased) -> the addresses safeFetch validated for it, most
 *  recent last. Bounded so a long crawl cannot grow it without limit. */
const vettedHosts = new Map<string, VettedEntry>();
const VETTED_MAX = 512;

function rememberVetted(hostname: string, entry: VettedEntry): void {
  const key = hostname.trim().toLowerCase();
  vettedHosts.delete(key);
  vettedHosts.set(key, entry);
  while (vettedHosts.size > VETTED_MAX) {
    const oldest = vettedHosts.keys().next().value;
    if (oldest === undefined) break;
    vettedHosts.delete(oldest);
  }
}

/** Test seam: forget every pinned host (never needed in production). */
export function clearVettedHosts(): void {
  vettedHosts.clear();
}

type ConnectLookupCallback = (
  err: Error | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

export type ConnectLookup = (
  hostname: string,
  options: { all?: boolean } | undefined,
  callback: ConnectLookupCallback,
) => void;

const familyOf = (address: string): number => (address.includes(":") ? 6 : 4);

/** The `connect.lookup` the pinned dispatcher installs. Exported so the
 *  TOCTOU behavior can be unit-tested without opening a socket. */
export function makePinnedLookup(registry: Map<string, VettedEntry> = vettedHosts): ConnectLookup {
  return (hostname, options, callback) => {
    const entry = registry.get(hostname.trim().toLowerCase());
    if (!entry || entry.addresses.length === 0) {
      callback(new Error(`saylent: ${hostname} was not vetted for this request`), "");
      return;
    }
    void entry
      .lookup(hostname)
      .then((fresh) => {
        const pinned = new Set(entry.addresses);
        const ok = fresh
          .map((r) => r.address)
          .filter((a) => pinned.has(a) && (entry.allowPrivate || !isPrivateIp(a)));
        if (ok.length === 0) {
          callback(new Error(`saylent: DNS answer for ${hostname} changed after validation`), "");
          return;
        }
        if (options?.all) {
          callback(
            null,
            ok.map((address) => ({ address, family: familyOf(address) })),
          );
        } else {
          callback(null, ok[0], familyOf(ok[0]));
        }
      })
      .catch(() => callback(new Error(`saylent: could not re-resolve ${hostname}`), ""));
  };
}

// undefined = never attempted, null = undici unavailable here.
let pinnedDispatcher: unknown | null | undefined;

async function getPinnedDispatcher(): Promise<unknown | undefined> {
  if (pinnedDispatcher !== undefined) return pinnedDispatcher ?? undefined;
  try {
    const { Agent } = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "undici")) as {
      Agent: new (opts: { connect: { lookup: ConnectLookup } }) => unknown;
    };
    pinnedDispatcher = new Agent({ connect: { lookup: makePinnedLookup() } });
  } catch {
    pinnedDispatcher = null;
  }
  return pinnedDispatcher ?? undefined;
}

// A single response body is read at most this many bytes before we stop pulling
// from the stream — an unbounded text() on a hostile/huge body is a memory DoS.
// stripHtmlToText's 40KB text cap runs downstream; this caps the raw bytes first.
const MAX_RESPONSE_BYTES = 2_000_000;

async function readCappedText(res: Response, maxBytes: number): Promise<string> {
  const body = res.body;
  if (!body) return (await res.text()).slice(0, maxBytes);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(Math.min(total, maxBytes));
  let off = 0;
  for (const c of chunks) {
    if (off >= out.length) break;
    const take = Math.min(c.length, out.length - off);
    out.set(c.subarray(0, take), off);
    off += take;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(out);
}

/** Safe outbound fetch — never throws; rejects non-http(s), private/
 *  encoded-IP literal hosts, AND hostnames that DNS-resolve into a private range
 *  (rebind defense); caps the body at ~2MB; 20s timeout; ≤3 redirects, each hop
 *  re-checked AND re-resolved. status 0 = network/guard fail.
 *
 * `allowPrivate` (default false, so every
 *  existing call site is byte-identical): when true, skips ONLY the
 *  private/internal-IP rejection (both the pre-DNS literal check and the
 *  post-DNS resolved-address check) for every hop of THIS call — scheme
 *  validation, the encoded-IPv4-evasion check folded into isBlockedHost, the
 *  body cap, the timeout and the redirect cap are all unchanged. The caller
 *  (packages/cli/src/run.ts buildCrawlerFetcher) is responsible for scoping
 *  this to the audited site's own host so third-party citation fetches never
 *  get it, and for printing the one-line risk warning — safeFetch itself has
 *  no console access and stays pure. */
export async function safeFetch(
  url: string,
  opts: {
    ua?: string;
    timeoutMs?: number;
    maxRedirects?: number;
    lookup?: HostLookup;
    allowPrivate?: boolean;
  } = {},
): Promise<SafeFetchResult> {
  // Browser-compatible convention (like every legitimate crawler: names the
  // tool + contact URL). A bare "SaylentAudit/1.0" with no contact URL got
  // silently 403'd by one production site's CDN, blanking the whole crawl —
  // hence the mandatory "+<contact url>" suffix below.
  const {
    ua = defaultUserAgent(),
    timeoutMs = 20000,
    maxRedirects = 3,
    lookup = defaultLookup,
    allowPrivate = false,
  } = opts;
  let current = url;
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const parsed = new URL(current);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { status: 0, finalUrl: current, text: "" };
      }
      if (!allowPrivate && isBlockedHost(parsed.hostname)) {
        return { status: 0, finalUrl: current, text: "" };
      }
      // DNS-rebind defense: resolve and reject if ANY address is private. Fail
      // closed — a host we cannot positively resolve to a public IP is not
      // fetched. allowPrivate still requires a resolvable address; it only
      // lifts the "must be public" requirement on that address.
      const resolved = await lookup(parsed.hostname).catch(() => null);
      if (!resolved || resolved.length === 0) {
        return { status: 0, finalUrl: current, text: "" };
      }
      if (!allowPrivate && resolved.some((r) => isPrivateIp(r.address))) {
        return { status: 0, finalUrl: current, text: "" };
      }
      // pin exactly these addresses for the socket this hop opens, so
      // the connection cannot land on an address the checks above never saw.
      rememberVetted(parsed.hostname, {
        addresses: resolved.map((r) => r.address),
        allowPrivate,
        lookup,
      });
      const dispatcher = await getPinnedDispatcher();
      const res = await fetch(current, {
        headers: { "user-agent": ua },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc || hop === maxRedirects) {
          return { status: res.status, finalUrl: current, text: "" };
        }
        current = new URL(loc, current).toString();
        continue;
      }
      const text = await readCappedText(res, MAX_RESPONSE_BYTES);
      return { status: res.status, finalUrl: current, text };
    }
    return { status: 0, finalUrl: current, text: "" };
  } catch {
    return { status: 0, finalUrl: current, text: "" };
  }
}

/** Wayback Machine fallback (fully legal: reads the PUBLIC ARCHIVE, never the
 * blocked site; we never impersonate a browser — project rule).
 * `id_` mode returns the ORIGINAL unrewritten HTML, so extraction is identical.
 * `fetcher` is injectable (default safeFetch) so corpus can route the lookup
 * through its mocked fetcher; crawl calls it with the default, unchanged. */
export async function archiveSnapshotUrl(
  url: string,
  fetcher: typeof safeFetch = safeFetch,
): Promise<string | null> {
  const res = await fetcher(
    `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
    { timeoutMs: 15000 },
  );
  if (res.status !== 200 || !res.text) return null;
  try {
    const j = JSON.parse(res.text) as {
      archived_snapshots?: { closest?: { available?: boolean; timestamp?: string } };
    };
    const c = j.archived_snapshots?.closest;
    if (!c?.available || !c.timestamp) return null;
    return `https://web.archive.org/web/${c.timestamp}id_/${url}`;
  } catch {
    return null;
  }
}

const ARCHIVE_WRAP = /^https?:\/\/web\.archive\.org\/web\/\d+(?:id_)?\/(https?:\/\/.+)$/;

/** Recover the ORIGINAL page URL from a Wayback snapshot URL (either the `id_`
 * form or a bare timestamped capture). Returns `u` unchanged when it is not a
 * web.archive.org wrapper. `final_url` (what the receipt opens) stays the
 * archive copy; identity — host, classification, merge key, fix targets — is
 * always the unwrapped original. Pure, unit-tested. */
export function unwrapArchiveUrl(u: string): string {
  return ARCHIVE_WRAP.exec(u)?.[1] ?? u;
}
