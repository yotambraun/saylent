// Operator/dev use: turns a REAL run bundle (packages/engine/src/bundle.ts
// RunBundleV1 — what `saylent audit` writes as run.json) into a public-safe
// sample by replacing every real third-party name and domain it found with a
// stable, deterministic fictional counterpart on a `.example` host.
// This is the mechanism required before a real audit of the hosted fictional
// brand (Kestrel Uptime) can ship as a public sample: the numbers, gates,
// fixes, and citation structure stay REAL; only the names of companies we do
// not own are swapped, everywhere they appear (run header aliases are never
// touched) — including nested answer.samples, so no real company's AI
// opinion is republished verbatim. This keeps the sample report legally safe
// to publish without misrepresenting any third party.
//
// HOST POLICY (2026-09-10 — this is the part that makes the promise in
// examples/kestrel/README.md true by construction rather than by whoever
// curated the map remembering to add a row):
//
//   EVERY third-party host that appears anywhere in the bundle — citation
//   URLs, citation.host, corpus page URLs, contact emails/forms, URLs inside
//   answer text, fixes, the source map, share-of-voice — is replaced with a
//   stable fictional `.example` host. There is no "incidental infra" or
//   "source, not subject" carve-out. Three narrow exceptions, all kept in
//   this file so they are auditable:
//
//     1. PUBLIC_PLATFORM_HOSTS — user-generated-content platforms that carry
//        no product/company claim of their own (Wikipedia, Reddit, HN,
//        Stack Overflow, GitHub, YouTube, Medium). These may stay as a HOST.
//        A URL PATH on one of them that carries a personal handle
//        (/@name, /u/name, /user/name, /users/name) is still scrubbed to
//        `/author-profile`, and a per-user SUBDOMAIN (name.medium.com) is
//        folded back to the bare platform + `/author-profile`, because a
//        private individual is not a public platform.
//     2. TECHNICAL_HOSTS — spec/vocabulary URLs and documentation
//        placeholders that are not anybody's site and whose replacement
//        would make a generated fix artifact WRONG (schema.org inside a
//        JSON-LD @context; yourdomain.com as a "put your domain here"
//        placeholder).
//     3. Our own brand's domain (read off the bundle, never guessed).
//
//   The private map may still override exception 1: a curated entry always
//   wins, so a platform host whose PATHS carry real org identity can be
//   pseudonymized anyway. Overriding is always in the stricter direction.
//
//   Any host with no curated entry gets a deterministic auto-generated
//   pseudonym (stable for the life of the map, because the script writes its
//   additions back into the private map file), and its registrable base is
//   mapped too, so a bare "rootstuff.io" in a citation title is covered by
//   the entry generated for "sentinel.rootstuff.io".
//
//   Page TITLES are handled structurally: a title sitting next to a URL gets
//   the real site's own name (derived from the host) swapped for the host's
//   pseudonym display name, and any "| by <person>" byline stripped.
//
// This script ships in scripts/, which is public (open-source snapshot
// allow-list) — so it MUST NOT contain any real vendor name/host itself.
// The public-platform/technical exception lists above are the only hostnames
// in this file, and they are all generic public infrastructure. The actual
// name→pseudonym registry lives in a file YOU keep outside the published
// tree, and this script has no default for it and names no such path.
//
// Usage:
//   npx tsx --tsconfig scripts/tsconfig.json scripts/pseudonymize-run.ts \
//     <in.run.json> <out.run.json> --map <your-pseudonym-map.json>
//
// --map <path> is REQUIRED and must exist. Its shape:
//
//   {
//     "names": { "Real Company": "Fictional Co", ... },   // exact display names
//     "hosts": { "realhost.com": "pseudo.example", ... }  // bare hostnames,
//                                                         // values on `.example`
//   }
//
// Both objects are required keys but may be empty ({}), and both are matched
// case-insensitively; the longest real key wins, so a subdomain entry beats its
// registrable base. Without --map the script refuses to run rather than silently
// publishing real names. The map is written back to the SAME path (auto-generated
// host rows are persisted so they never drift), so point it at a file that is not
// under scripts/ or any other published path.
//
// --suggest <in.run.json>: does NOT pseudonymize or require --map. Instead it
// scans the bundle for CANDIDATE real names/hosts an operator should add to
// the private map — every distinct citation/corpus-page host, and every
// distinct `verdict.other_brands[].name` the engines already called out
// structurally — and prints them. It carries no built-in list; it only
// reports what it finds in this specific bundle, for a human to review and
// add to your own map file by hand.
//
// Text replacement rules:
//   * hosts   — literal, case-insensitive substring replace, longest real
//               host first (a hostname has no useful "word boundary" notion).
//   * names   — word-boundary, possessive ('s) / plural (s) preserving.
//               A SINGLE-token name matches case-insensitively and preserves
//               the source's case. A MULTI-WORD name matches only in its
//               registered casing (or the all-upper / all-lower form of it),
//               because a case-insensitive multi-word match mangles ordinary
//               prose: "Will <Brand> alert us when…" must not become
//               "Will <Rival Alert pseudonym> us when…".
//               An acronym entry (registered ALL-CAPS, e.g. a 3-letter cloud)
//               never up-cases its pseudonym — "CLOUDMERE" in a
//               share-of-voice key reads as a formatting bug.
//   * tails   — a preview/excerpt field that upstream already cut mid-name
//               ("…already use Datad") leaves a real-name FRAGMENT that no
//               whole-name pass can see. After the main passes, any
//               excerpt/preview/snippet field ending in a ≥5-char prefix of a
//               mapped name has that fragment completed to the pseudonym.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { readBundle, writeBundle, type RunBundleV1 } from "@saylent/engine/bundle";

// ---------------------------------------------------------------------------
// the map shape
// ---------------------------------------------------------------------------

export interface PseudonymMap {
  /** brand/product NAME → fictional name (prose text; see casing rules above). */
  names: Record<string, string>;
  /** exact hostname/domain → fictional `.example` host (literal substring
   *  match, longest real host first so a subdomain wins over its parent). */
  hosts: Record<string, string>;
  /** names kept REAL on purpose: infrastructure
   *  vendors a fix tells the reader to open in their own dashboard (CDNs, web
   *  servers, hosting platforms). They are never the subject of a claim, and a
   *  fictional CDN table would make the fix wrong. Protected as literals, so a
   *  shorter map entry ("AWS") cannot eat a kept phrase ("AWS CloudFront"). */
  keep?: string[];
}

/** Hosts of those infrastructure vendors, kept real for the same reason
 *  (a fix may link their bot-management documentation). */
export const INFRASTRUCTURE_HOSTS = [
  "cloudflare.com",
  "fastly.com",
  "akamai.com",
  "nginx.org",
  "httpd.apache.org",
  "caddyserver.com",
  "vercel.com",
  "netlify.com",
];

export function isInfrastructureHost(host: string): boolean {
  return INFRASTRUCTURE_HOSTS.some((e) => host === e || host.endsWith(`.${e}`));
}

// ---------------------------------------------------------------------------
// host policy
// ---------------------------------------------------------------------------

/** Public user-generated-content platforms: a citation here is a link to a
 *  page anyone can publish, not a company being recommended. Kept as a HOST
 *  only — see the personal-handle rules below. A curated map entry overrides
 *  any of these (always in the stricter direction). */
export const PUBLIC_PLATFORM_HOSTS = [
  "wikipedia.org",
  "reddit.com",
  "news.ycombinator.com",
  "ycombinator.com",
  "stackoverflow.com",
  "github.com",
  "youtube.com",
  "medium.com",
];

/** Not anybody's website: a spec vocabulary URL or a documentation
 *  placeholder. Replacing these would make a generated fix artifact wrong
 *  (a JSON-LD `"@context"` must literally be the schema vocabulary URL, and
 *  a "put your own domain here" placeholder must still read as one). */
export const TECHNICAL_HOSTS = ["schema.org", "www.w3.org", "yourdomain.com", "example.com", "example.org"];

/** Platforms that give every user their own SUBDOMAIN — a handle in the host,
 *  which the path rules cannot reach. */
const HANDLE_SUBDOMAIN_PLATFORMS = ["medium.com"];

/** Multi-label public suffixes we care about, so the "registrable base" of
 *  `www.somesite.com.au` is `somesite.com.au`, not `com.au`. */
const MULTI_LABEL_SUFFIXES = [
  "com.au",
  "com.br",
  "com.cn",
  "com.mx",
  "com.sa",
  "com.tr",
  "co.il",
  "co.in",
  "co.jp",
  "co.nz",
  "co.uk",
  "co.za",
];

/** Deterministic fictional-host vocabulary. 16×16 = 256 stable combinations,
 *  picked by a hash of the real registrable base, so the same real host
 *  always lands on the same fictional host even if the map file is lost. */
const PSEUDO_ADJECTIVES = [
  "north",
  "bright",
  "quiet",
  "amber",
  "cedar",
  "silver",
  "stone",
  "river",
  "glass",
  "iron",
  "violet",
  "umber",
  "solace",
  "lantern",
  "meadow",
  "cobalt",
];
const PSEUDO_NOUNS = [
  "vale",
  "ridge",
  "field",
  "harbour",
  "point",
  "gate",
  "spire",
  "basin",
  "hollow",
  "reach",
  "crest",
  "banks",
  "grove",
  "landing",
  "summit",
  "strand",
];

function hostMatches(host: string, entry: string): boolean {
  return host === entry || host.endsWith(`.${entry}`);
}

export function isPublicPlatformHost(host: string): boolean {
  return PUBLIC_PLATFORM_HOSTS.some((e) => hostMatches(host, e));
}

function isTechnicalHost(host: string): boolean {
  return TECHNICAL_HOSTS.some((e) => hostMatches(host, e));
}

/** `docs.foo.co.uk` → `foo.co.uk`; `foo.com` → `foo.com`. */
export function registrableBase(host: string): string {
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  const take = MULTI_LABEL_SUFFIXES.includes(lastTwo) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** FNV-1a, 32-bit — a tiny stable hash, no dependency. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic fictional base for a real registrable base, avoiding any
 *  pseudonym already taken (walk the vocabulary from the hashed start). */
export function autoPseudonymBase(realBase: string, taken: Set<string>): string {
  const h = hash32(realBase);
  const total = PSEUDO_ADJECTIVES.length * PSEUDO_NOUNS.length;
  for (let attempt = 0; attempt < total * 4; attempt++) {
    const idx = (h + attempt * 37) % total;
    const word = `${PSEUDO_ADJECTIVES[Math.floor(idx / PSEUDO_NOUNS.length)]}${PSEUDO_NOUNS[idx % PSEUDO_NOUNS.length]}`;
    const suffix = attempt < total ? "" : String(Math.floor(attempt / total) + 1);
    const candidate = `${word}${suffix}.example`;
    if (!taken.has(candidate)) return candidate;
  }
  // Unreachable for any realistic bundle; keep it total rather than throwing.
  return `site-${h.toString(16)}.example`;
}

/** `northvale.example` → "Northvale"; `hawkeye-monitor.example` → "Hawkeye Monitor". */
export function displayNameForPseudoHost(pseudoHost: string): string {
  const base = registrableBase(pseudoHost).replace(/\.example$/, "");
  return base
    .split(/[-.]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const URL_RE = /https?:\/\/[^\s"'`<>()[\]\\{}]+/gi;
const EMAIL_HOST_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;

function forEachString(value: unknown, fn: (s: string, key: string) => void, key = ""): void {
  if (typeof value === "string") return fn(value, key);
  if (Array.isArray(value)) {
    for (const v of value) forEachString(v, fn, key);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      fn(k, "");
      forEachString(v, fn, k);
    }
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase().replace(/:\d+$/, "");
  } catch {
    return null;
  }
}

/** Every third-party host that appears ANYWHERE in the bundle: citation.host
 *  rows, hosts inside any URL in any string, and contact-email domains. */
export function collectHosts(bundle: RunBundleV1): string[] {
  const hosts = new Set<string>();
  const add = (h: string | null | undefined) => {
    if (!h) return;
    const clean = h.toLowerCase().replace(/^\/+/, "").replace(/[.,;:)\]]+$/, "").replace(/:\d+$/, "");
    if (clean.includes(".")) hosts.add(clean);
  };
  for (const c of bundle.citations ?? []) add(c.host);
  forEachString(bundle, (s) => {
    for (const m of s.match(URL_RE) ?? []) add(hostOf(m));
    for (const m of s.matchAll(EMAIL_HOST_RE)) add(m[1]);
  });
  return [...hosts].sort();
}

export interface HostPolicyRow {
  host: string;
  pseudonym: string | null;
  reason: "curated" | "auto" | "auto-base" | "public-platform" | "technical" | "infrastructure" | "own-brand" | "already-fictional";
}

/** Build the effective host map: curated entries + a deterministic pseudonym
 *  for every other third-party host in the bundle. Returns the rows so the
 *  CLI can print a report of every host replaced and persist the additions. */
export function buildHostPolicy(
  bundle: RunBundleV1,
  map: PseudonymMap,
): { hosts: Record<string, string>; rows: HostPolicyRow[]; added: Record<string, string> } {
  const brandDomain = (bundle.run?.brand?.domain ?? "").toLowerCase();
  const isOwn = (h: string) =>
    !!brandDomain && (h === brandDomain || h.endsWith(`.${brandDomain}`) || brandDomain.endsWith(`.${h}`));

  const hosts: Record<string, string> = { ...map.hosts };
  const added: Record<string, string> = {};
  const taken = new Set(Object.values(hosts));
  const rows: HostPolicyRow[] = [];

  // Registrable bases too: a citation TITLE is often the bare base
  // ("rootstuff.io") while the URL carries a subdomain.
  const seen = collectHosts(bundle);
  const withBases = new Set(seen);
  for (const h of seen) withBases.add(registrableBase(h));

  for (const host of [...withBases].sort()) {
    if (hosts[host]) {
      rows.push({ host, pseudonym: hosts[host], reason: "curated" });
      continue;
    }
    if (isOwn(host)) {
      rows.push({ host, pseudonym: null, reason: "own-brand" });
      continue;
    }
    if (host.endsWith(".example")) {
      rows.push({ host, pseudonym: null, reason: "already-fictional" });
      continue;
    }
    // A per-user subdomain on a kept platform (name.medium.com) is a private
    // individual's handle in the HOST — fold it onto the bare platform, so a
    // stored `citation.host` field agrees with the scrubbed URL.
    const userSub = HANDLE_SUBDOMAIN_PLATFORMS.find(
      (p) => host.endsWith(`.${p}`) && host !== `www.${p}`,
    );
    if (userSub) {
      hosts[host] = userSub;
      added[host] = userSub;
      rows.push({ host, pseudonym: userSub, reason: "auto" });
      continue;
    }
    if (isTechnicalHost(host)) {
      rows.push({ host, pseudonym: null, reason: "technical" });
      continue;
    }
    if (isPublicPlatformHost(host)) {
      rows.push({ host, pseudonym: null, reason: "public-platform" });
      continue;
    }
    if (isInfrastructureHost(host)) {
      rows.push({ host, pseudonym: null, reason: "infrastructure" });
      continue;
    }
    const base = registrableBase(host);
    let pseudo: string;
    if (hosts[base]) {
      // subdomain of an already-mapped base: keep the subdomain labels
      const sub = host.slice(0, host.length - base.length);
      pseudo = `${sub}${hosts[base]}`;
    } else {
      const pseudoBase = autoPseudonymBase(base, taken);
      taken.add(pseudoBase);
      hosts[base] = pseudoBase;
      added[base] = pseudoBase;
      if (base !== host) rows.push({ host: base, pseudonym: pseudoBase, reason: "auto-base" });
      const sub = host.slice(0, host.length - base.length);
      pseudo = `${sub}${pseudoBase}`;
    }
    hosts[host] = pseudo;
    added[host] = pseudo;
    rows.push({ host, pseudonym: pseudo, reason: "auto" });
  }

  return { hosts, rows, added };
}

// ---------------------------------------------------------------------------
// merge, replace, walk
// ---------------------------------------------------------------------------

export function mergeMaps(base: PseudonymMap, extra: PseudonymMap | undefined): PseudonymMap {
  if (!extra) return base;
  return {
    names: { ...base.names, ...extra.names },
    hosts: { ...base.hosts, ...extra.hosts },
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Longest-real-string-first so "docs.rivalco.com" consumes before bare
 *  "rivalco.com", and "Rival Cloud Synthetic Monitoring" before "Rival Cloud". */
function byRealLengthDesc(entries: [string, string][]): [string, string][] {
  return [...entries].sort((a, b) => b[0].length - a[0].length);
}

function applyCase(real: string, matchedBase: string, pseudo: string): string {
  // An acronym entry (registered ALL-CAPS) must never up-case its pseudonym:
  // "CLOUDMERE" in a share-of-voice key reads as a formatting bug, not a name.
  if (real === real.toUpperCase() && /[A-Z]/.test(real)) return pseudo;
  if (matchedBase === matchedBase.toUpperCase() && /[A-Z]/.test(matchedBase)) return pseudo.toUpperCase();
  if (matchedBase === matchedBase.toLowerCase()) return pseudo.toLowerCase();
  return pseudo;
}

/** A hostname/domain string never needs a "word boundary" (dots, hyphens are
 *  already unambiguous) — plain case-insensitive literal substring replace. */
function replaceHosts(input: string, hosts: [string, string][]): { text: string; count: number } {
  let text = input;
  let count = 0;
  for (const [real, pseudo] of byRealLengthDesc(hosts)) {
    const re = new RegExp(escapeRegex(real), "gi");
    text = text.replace(re, () => {
      count++;
      return pseudo;
    });
  }
  return { text, count };
}

/** Word-boundary + possessive/plural-aware prose replace.
 *  A trailing \b is only meaningful when `real` ends in a word character
 *  (letters/digits) — a name ending in ")" like "Brand (brand.example)"
 *  gets no trailing boundary (there is nothing to bound against).
 *  Single-token entries match case-insensitively and preserve the source
 *  case; multi-word entries match ONLY their registered casing (or the
 *  all-upper / all-lower form), because a loose multi-word match mangles
 *  ordinary prose that happens to contain the words. */
function replaceNames(input: string, names: [string, string][]): { text: string; count: number } {
  let text = input;
  let count = 0;
  for (const [real, pseudo] of byRealLengthDesc(names)) {
    const startsWord = /^\w/.test(real);
    const endsWord = /\w$/.test(real);
    const start = startsWord ? "\\b" : "";
    const suffix = endsWord ? "('s|s)?" : "()?";
    const end = endsWord ? "\\b" : "";
    const multiWord = /\s/.test(real);
    const forms = multiWord
      ? [...new Set([real, real.toUpperCase(), real.toLowerCase()])]
      : [real];
    const body = forms.map(escapeRegex).join("|");
    const re = new RegExp(`${start}(${body})${suffix}${end}`, multiWord ? "g" : "gi");
    text = text.replace(re, (_whole, base: string, suf: string | undefined) => {
      count++;
      return applyCase(real, base, pseudo) + (suf ?? "");
    });
  }
  return { text, count };
}

/** Upstream sometimes stores a PRE-CUT preview/excerpt. When the cut lands
 *  inside a real name ("…already use Datad") no whole-name pass can see it,
 *  and the published sample keeps a recognizable fragment of a real company.
 *  Complete any such trailing fragment to the pseudonym. Deliberately narrow:
 *  only excerpt/preview/snippet-shaped fields, only long strings, only a
 *  fragment of ≥5 characters, and only at the very end (optionally followed
 *  by an ellipsis) — so ordinary prose can never trip it. */
const TRUNCATABLE_KEY_RE = /(^|_)(excerpt|preview|snippet)$/i;

export function repairTruncatedTail(
  input: string,
  entries: [string, string][],
  opts: { minFragment: number; caseSensitive?: boolean; requireDot?: boolean },
): { text: string; repaired: string | null } {
  if (input.length < 80) return { text: input, repaired: null };
  for (const [real, pseudo] of byRealLengthDesc(entries)) {
    for (let len = real.length - 1; len >= opts.minFragment; len--) {
      const frag = real.slice(0, len);
      if (!/\w$/.test(frag)) continue;
      // A partial HOST is only identifiable as a host once it carries its
      // dot — otherwise "…a website uptime monito" (a cut ordinary word)
      // looks exactly like the head of a monitoring vendor's domain.
      if (opts.requireDot && !frag.includes(".")) continue;
      const m = new RegExp(`(^|[^\\w])(${escapeRegex(frag)})(\\.{3}|…)?$`, opts.caseSensitive ? "" : "i").exec(
        input,
      );
      if (!m) continue;
      const head = input.slice(0, m.index + m[1].length);
      return {
        text: head + pseudo + (m[3] ?? ""),
        repaired: `…${head.slice(-60)}[${frag}] → [${pseudo}]`,
      };
    }
  }
  return { text: input, repaired: null };
}

/** A REAL run can carry a verdict.excerpt (or any other stored, pre-cut field)
 *  that was truncated upstream with a raw UTF-16 length cut landing mid
 *  surrogate-pair — a lone high/low surrogate has no valid UTF-8 encoding, so
 *  what it becomes is encoder-dependent, which makes any consumer that
 *  serializes it (JSON.stringify, a snapshot file, a terminal) NON-
 *  deterministic. This is a data-quality issue independent of pseudonymization
 *  (found in the real Kestrel Uptime capture's verdict.excerpt for q14/claude,
 *  cut right after "## 🚨"), repaired here because this script already walks
 *  every string in the bundle exactly once. */
function stripLoneSurrogates(s: string): { text: string; repaired: boolean } {
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
  if (!LONE_SURROGATE.test(s)) return { text: s, repaired: false };
  return { text: s.replace(LONE_SURROGATE, ""), repaired: true };
}

interface Tally {
  count: number;
  repairs: number;
  truncations: string[];
}

/** Run `fn` with every protected literal (our OWN brand domain) masked out,
 *  then restore it byte-for-byte. Our own domain can literally contain a
 *  third-party name we DO pseudonymize (a PaaS whose name is a label of the
 *  host our fictional brand is deployed on): without masking, replacing that
 *  name in prose would also corrupt our own domain everywhere it appears —
 *  which used to force a manual, undocumented post-run find-replace. */
function withProtected(input: string, protectedLiterals: string[], fn: (s: string) => string): string {
  if (protectedLiterals.length === 0) return fn(input);
  const found: string[] = [];
  let masked = input;
  for (const lit of [...protectedLiterals].sort((a, b) => b.length - a.length)) {
    masked = masked.replace(new RegExp(escapeRegex(lit), "gi"), (m) => {
      found.push(m);
      return `\u0000${found.length - 1}\u0000`;
    });
  }
  if (found.length === 0) return fn(input);
  return fn(masked).replace(/\u0000(\d+)\u0000/g, (_m, i: string) => found[Number(i)] ?? "");
}

function pseudonymizeString(
  s: string,
  map: PseudonymMap,
  key: string,
  tally: Tally,
  protectedLiterals: string[] = [],
): string {
  const { text: repairedText, repaired } = stripLoneSurrogates(s);
  if (repaired) tally.repairs += 1;
  let text = withProtected(repairedText, protectedLiterals, (masked) => {
    const hostPass = replaceHosts(masked, Object.entries(map.hosts));
    const namePass = replaceNames(hostPass.text, Object.entries(map.names));
    tally.count += hostPass.count + namePass.count;
    return namePass.text;
  });
  if (TRUNCATABLE_KEY_RE.test(key)) {
    const nameTail = repairTruncatedTail(text, Object.entries(map.names), {
      minFragment: 5,
      caseSensitive: true,
    });
    if (nameTail.repaired) tally.truncations.push(nameTail.repaired);
    text = nameTail.text;
    const hostTail = repairTruncatedTail(text, Object.entries(map.hosts), {
      minFragment: 6,
      requireDot: true,
    });
    if (hostTail.repaired) tally.truncations.push(hostTail.repaired);
    text = hostTail.text;
  }
  return text;
}

/** Recursively walk any JSON-like value, replacing every string leaf AND
 *  every object key — share_of_voice rows carry the rival name as the KEY
 *  ({"Rivalco": 9}), not a value, so a values-only walk would miss the
 *  single most important field. Applied to the WHOLE bundle — run header
 *  aliases stay untouched simply because our own brand name/domain are
 *  never in the map (the map holds only real third-party names/hosts, loaded
 *  from the private --map file plus the host policy), so nothing needs to be
 *  excluded by path. */
function walkAndReplace(
  value: unknown,
  map: PseudonymMap,
  tally: Tally,
  key = "",
  protectedLiterals: string[] = [],
): unknown {
  if (typeof value === "string") return pseudonymizeString(value, map, key, tally, protectedLiterals);
  if (Array.isArray(value)) return value.map((v) => walkAndReplace(v, map, tally, key, protectedLiterals));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const newKey = pseudonymizeString(k, map, "", tally, protectedLiterals);
      out[newKey] = walkAndReplace(v, map, tally, k, protectedLiterals);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// URL + title structural passes (run BEFORE the text passes, because they
// need to see the REAL host next to the string they are fixing)
// ---------------------------------------------------------------------------

const HANDLE_PATH_RE = /^\/(?:@[^/]+|u\/[^/]+|users?\/[^/]+)(?:\/.*)?$/i;

/** Scrub a personal identity out of a URL on a kept public platform:
 *  a handle PATH becomes `/author-profile`, and a per-user SUBDOMAIN is
 *  folded back onto the bare platform host with the same `/author-profile`. */
export function scrubHandleUrl(raw: string): { url: string; changed: boolean } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { url: raw, changed: false };
  }
  const host = u.host.toLowerCase();
  let changed = false;

  const userSubPlatform = HANDLE_SUBDOMAIN_PLATFORMS.find(
    (p) => host.endsWith(`.${p}`) && host !== `www.${p}`,
  );
  if (userSubPlatform) {
    u.host = userSubPlatform;
    u.pathname = "/author-profile";
    u.search = "";
    u.hash = "";
    changed = true;
  } else if (isPublicPlatformHost(host) && HANDLE_PATH_RE.test(u.pathname)) {
    u.pathname = "/author-profile";
    u.search = "";
    u.hash = "";
    changed = true;
  }
  return { url: changed ? u.toString() : raw, changed };
}

function scrubHandlesInString(s: string): { text: string; count: number } {
  let count = 0;
  const text = s.replace(URL_RE, (m) => {
    // don't swallow trailing sentence punctuation
    const trail = /[.,;:)\]]+$/.exec(m)?.[0] ?? "";
    const core = trail ? m.slice(0, -trail.length) : m;
    const { url, changed } = scrubHandleUrl(core);
    if (changed) count++;
    return url + trail;
  });
  return { text, count };
}

/** The name variants a site's own base label can appear as inside a page
 *  title: "web-alert", "webalert", "web alert". Deliberately NOT a
 *  letter-by-letter fuzzy match — "isdown" must not match "is down". */
function titleTokenForms(baseLabel: string): string[] {
  const forms = new Set<string>([baseLabel]);
  forms.add(baseLabel.replace(/[^a-z0-9]/gi, ""));
  forms.add(baseLabel.replace(/[^a-z0-9]/gi, " "));
  return [...forms].filter((f) => f.replace(/\s/g, "").length >= 5);
}

const TITLE_TLD_RE = "(?:\\.(?:com|io|net|org|app|dev|ai|co|me|cloud|so|sh|xyz|gov|ir|sa))?";
const BYLINE_RE = /\s*[|·—–-]\s*by\s+[^|·—–]+?(?=\s*[|·—–]|$)/gi;

/** Fix ONE page title, given the real host it belongs to: strip an author
 *  byline (a private individual is never republished), and swap the site's
 *  own name for the pseudonym display name so the title agrees with the URL. */
export function fixTitle(title: string, realHost: string, hostMap: Record<string, string>): string {
  let out = title.replace(BYLINE_RE, "");
  const base = registrableBase(realHost.toLowerCase());
  const pseudoHost = hostMap[realHost.toLowerCase()] ?? hostMap[base];
  if (!pseudoHost) return out;
  const display = displayNameForPseudoHost(pseudoHost);
  const baseLabel = base.split(".")[0];
  for (const form of titleTokenForms(baseLabel)) {
    const re = new RegExp(`\\b${escapeRegex(form).replace(/\\?\s/g, "[\\s-]")}${TITLE_TLD_RE}\\b`, "gi");
    out = out.replace(re, display);
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

const URL_KEYS = ["url", "final_url", "normUrl", "norm_url", "link", "href", "form_url"];

/** Walk the bundle for objects that pair a `title` with a URL, and fix the
 *  title against that URL's REAL host. Structural, so it works for
 *  citations, answers[].citations, samples[].citations and corpus_pages
 *  without hard-coding any of those paths. */
function fixTitlesInPlace(value: unknown, hostMap: Record<string, string>, tally: { count: number }): void {
  if (Array.isArray(value)) {
    for (const v of value) fixTitlesInPlace(v, hostMap, tally);
    return;
  }
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  if (typeof obj.title === "string") {
    const urlKey = URL_KEYS.find((k) => typeof obj[k] === "string" && /^https?:/i.test(obj[k] as string));
    const host = urlKey ? hostOf(obj[urlKey] as string) : typeof obj.host === "string" ? obj.host : null;
    if (host) {
      const fixed = fixTitle(obj.title, host, hostMap);
      if (fixed !== obj.title) {
        obj.title = fixed;
        tally.count++;
      }
    }
  }
  for (const v of Object.values(obj)) fixTitlesInPlace(v, hostMap, tally);
}

function scrubHandlesInPlace(value: unknown, tally: { count: number }): unknown {
  if (typeof value === "string") {
    const { text, count } = scrubHandlesInString(value);
    tally.count += count;
    return text;
  }
  if (Array.isArray(value)) return value.map((v) => scrubHandlesInPlace(v, tally));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubHandlesInPlace(v, tally);
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// the transform
// ---------------------------------------------------------------------------

export interface PseudonymizeResult {
  bundle: RunBundleV1;
  counts: Record<string, number>;
  repairs: number;
  /** every host seen in the bundle and what the policy did with it */
  hostRows: HostPolicyRow[];
  /** host entries the policy generated (to persist into the private map) */
  addedHosts: Record<string, string>;
  /** the map actually applied (curated + generated hosts) */
  effectiveMap: PseudonymMap;
  titlesFixed: number;
  handlesScrubbed: number;
  truncations: string[];
}

/** Pure transform: bundle in, pseudonymized bundle out, plus a per-field
 *  replacement count and the policy report for the caller to print/verify.
 *  Exported so the test can run this against a tiny synthetic bundle with
 *  its own map, without going through argv/fs at all. */
export function pseudonymizeBundle(bundle: RunBundleV1, map: PseudonymMap): PseudonymizeResult {
  const policy = buildHostPolicy(bundle, map);
  const effectiveMap: PseudonymMap = { names: { ...map.names }, hosts: policy.hosts };
  // Our own domain is masked during replacement (see withProtected). Only the
  // DOMAIN, never the brand name/aliases: the brand's word can legitimately be
  // part of a real homonym company's product name that must be pseudonymized.
  const protectedLiterals = [
    ...new Set([bundle.run?.brand?.domain, bundle.brand_model?.domain, ...(map.keep ?? [])]),
  ].filter((v): v is string => typeof v === "string" && v.length > 0);

  // 1. structural passes on a deep copy, while the REAL hosts are still there
  const handleTally = { count: 0 };
  const working = scrubHandlesInPlace(
    JSON.parse(JSON.stringify(bundle)),
    handleTally,
  ) as RunBundleV1;
  const titleTally = { count: 0 };
  fixTitlesInPlace(working, effectiveMap.hosts, titleTally);

  // 2. text passes over every field
  const fields: (keyof RunBundleV1)[] = [
    "run",
    "brand_model",
    "questions",
    "answers",
    "citations",
    "corpus_pages",
    "domain_checks",
    "fixes",
    "scores",
    "health",
  ];
  const counts: Record<string, number> = {};
  let repairs = 0;
  const truncations: string[] = [];
  const out = { ...working } as RunBundleV1;
  for (const f of fields) {
    const tally: Tally = { count: 0, repairs: 0, truncations: [] };
    (out as unknown as Record<string, unknown>)[f] = walkAndReplace(
      working[f],
      effectiveMap,
      tally,
      f,
      protectedLiterals,
    );
    counts[f] = tally.count;
    repairs += tally.repairs;
    truncations.push(...tally.truncations);
  }

  // Safety net: our own brand identity must survive byte-for-byte. If this
  // ever fires, a map entry has been defined that collides with our brand
  // name/domain/aliases — that is a registry bug, not something to silently
  // "fix" by skipping the field.
  const before = bundle.run.brand;
  const after = out.run.brand;
  if (before.name !== after.name || before.domain !== after.domain) {
    throw new Error(
      `pseudonymize-run: our own brand changed ("${before.name}"/"${before.domain}" → ` +
        `"${after.name}"/"${after.domain}") — a map entry collides with the brand; fix the registry`,
    );
  }
  if (JSON.stringify(bundle.brand_model.aliases) !== JSON.stringify(out.brand_model.aliases)) {
    throw new Error("pseudonymize-run: brand_model.aliases changed — a map entry collides with the brand");
  }

  return {
    bundle: out,
    counts,
    repairs,
    hostRows: policy.rows,
    addedHosts: policy.added,
    effectiveMap,
    titlesFixed: titleTally.count,
    handlesScrubbed: handleTally.count,
    truncations,
  };
}

/** Post-condition check: no host outside the kept-set survives in the output.
 *  Exported so the test (and the CLI) can assert the promise the public
 *  README makes, instead of trusting the map to be complete. */
export function auditOutputHosts(bundle: RunBundleV1): { host: string; kept: string }[] {
  const brandDomain = (bundle.run?.brand?.domain ?? "").toLowerCase();
  const leaks: { host: string; kept: string }[] = [];
  for (const host of collectHosts(bundle)) {
    if (host.endsWith(".example")) continue;
    if (brandDomain && (host === brandDomain || host.endsWith(`.${brandDomain}`))) continue;
    if (isPublicPlatformHost(host)) continue;
    if (isTechnicalHost(host)) continue;
    if (isInfrastructureHost(host)) continue;
    leaks.push({ host, kept: "UNEXPECTED" });
  }
  return leaks;
}

// ---------------------------------------------------------------------------
// --suggest: candidate discovery (no built-in list, no replacement)
// ---------------------------------------------------------------------------

/** Walk the bundle collecting (a) every distinct citation/corpus-page host
 *  and (b) every distinct `verdict.other_brands[].name` the engines already
 *  called out structurally. Both are read straight off already-parsed
 *  bundle fields (not a text scan), so this needs no name-guessing heuristic
 *  and carries no built-in list of real companies. */
export function suggestCandidates(bundle: RunBundleV1): { hosts: string[]; names: string[] } {
  const hosts = new Set<string>(collectHosts(bundle));
  const names = new Set<string>();

  const collectVerdict = (verdict: { other_brands?: { name: string }[] } | null | undefined) => {
    for (const b of verdict?.other_brands ?? []) {
      if (b.name) names.add(b.name);
    }
  };
  for (const a of bundle.answers ?? []) {
    collectVerdict(a.verdict);
    for (const s of a.samples ?? []) collectVerdict(s.verdict);
  }
  const sov = (bundle.scores as unknown as { share_of_voice?: Record<string, number> } | null)
    ?.share_of_voice;
  for (const name of Object.keys(sov ?? {})) names.add(name);

  return { hosts: [...hosts].sort(), names: [...names].sort() };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  suggest: boolean;
  input: string;
  output?: string;
  mapPath?: string;
} {
  const suggest = argv.includes("--suggest");
  const mapFlagIdx = argv.indexOf("--map");
  const mapPath = mapFlagIdx !== -1 ? argv[mapFlagIdx + 1] : undefined;
  const positional = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--map");

  if (suggest) {
    const [input] = positional;
    if (!input) {
      throw new Error("usage: pseudonymize-run.ts --suggest <in.run.json>");
    }
    return { suggest, input };
  }

  const [input, output] = positional;
  if (!input || !output) {
    throw new Error(
      "usage: pseudonymize-run.ts <in.run.json> <out.run.json> --map <map.json>\n" +
        "   or: pseudonymize-run.ts --suggest <in.run.json>",
    );
  }
  if (!mapPath) {
    throw new Error(
      "pseudonymize-run: --map <file> is required. This script ships publicly and holds " +
        "no built-in name registry — pass your own map file:\n" +
        "  --map <your-pseudonym-map.json>\n" +
        '(shape: { "names": { "Real Name": "Pseudonym" }, "hosts": { "realhost.com": ' +
        '"pseudo.example" } }; keep it outside the published tree, and run --suggest ' +
        "first to find candidates to add to it.)",
    );
  }
  if (!existsSync(mapPath)) {
    throw new Error(`pseudonymize-run: --map file not found: ${mapPath}`);
  }
  return { suggest, input, output, mapPath };
}

function loadExternalMap(mapPath: string): { map: PseudonymMap; raw: Record<string, unknown> } {
  const raw = JSON.parse(readFileSync(mapPath, "utf8")) as Record<string, unknown>;
  const parsed = raw as Partial<PseudonymMap>;
  return {
    map: { names: parsed.names ?? {}, hosts: parsed.hosts ?? {}, keep: parsed.keep ?? [] },
    raw,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const raw = JSON.parse(readFileSync(args.input, "utf8"));
  const bundle = readBundle(raw);

  if (args.suggest) {
    const { hosts, names } = suggestCandidates(bundle);
    console.log(`pseudonymize-run --suggest: ${args.input}`);
    console.log(`  candidate hosts (${hosts.length}) — review and add real ones to the private map:`);
    for (const h of hosts) console.log(`    ${h}`);
    console.log(`  candidate names (${names.length}) — from verdict.other_brands + share_of_voice:`);
    for (const n of names) console.log(`    ${n}`);
    console.log(
      "  nothing written — this is a read-only scan; add the real entries by hand to " +
        "the map file you pass with --map",
    );
    return;
  }

  const output = args.output!;
  const mapPath = args.mapPath!;
  const { map, raw: mapRaw } = loadExternalMap(mapPath);

  const result = pseudonymizeBundle(bundle, map);

  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, writeBundle(result.bundle));

  // Persist generated host rows so the pseudonyms are stable across re-runs,
  // preserving any other keys the private map carries (e.g. `_notes`).
  const nextMap = { ...mapRaw, names: map.names, hosts: result.effectiveMap.hosts };
  mkdirSync(path.dirname(mapPath), { recursive: true });
  writeFileSync(mapPath, `${JSON.stringify(nextMap, null, 2)}\n`);

  const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
  console.log(`pseudonymize-run: ${args.input} → ${output}`);
  console.log(
    `  names: ${Object.keys(map.names).length}, hosts: ${Object.keys(result.effectiveMap.hosts).length} (map → ${mapPath})`,
  );

  console.log("  host policy — every third-party host in the bundle:");
  const shown = new Set<string>();
  for (const row of result.hostRows) {
    if (shown.has(row.host)) continue;
    shown.add(row.host);
    const what = row.pseudonym ? `→ ${row.pseudonym}` : "kept";
    console.log(`    ${row.host.padEnd(34)} ${what.padEnd(38)} [${row.reason}]`);
  }
  const replaced = result.hostRows.filter((r) => r.pseudonym).length;
  const kept = result.hostRows.filter((r) => !r.pseudonym);
  console.log(`  hosts replaced: ${replaced}; kept: ${kept.length} (${kept.map((k) => k.host).join(", ") || "none"})`);
  if (Object.keys(result.addedHosts).length > 0) {
    console.log(`  new host rows written into the private map: ${Object.keys(result.addedHosts).length}`);
  }

  console.log("  replacements per field:");
  for (const [field, count] of Object.entries(result.counts)) console.log(`    ${field}: ${count}`);
  console.log(`  total: ${total}`);
  console.log(`  titles rewritten: ${result.titlesFixed}; personal handles scrubbed: ${result.handlesScrubbed}`);
  if (result.truncations.length > 0) {
    console.log("  truncated-name fragments completed:");
    for (const t of result.truncations) console.log(`    ${t}`);
  }
  if (result.repairs > 0) {
    console.log(
      `  encoding repairs: ${result.repairs} string(s) had a lone surrogate (an upstream ` +
        `mid-emoji truncation) stripped so serialization is deterministic`,
    );
  }

  const leaks = auditOutputHosts(result.bundle);
  if (leaks.length > 0) {
    throw new Error(
      `pseudonymize-run: ${leaks.length} real host(s) survived into the output — ` +
        `${leaks.map((l) => l.host).join(", ")}`,
    );
  }
  console.log("  post-check: no non-.example host outside the kept set survives in the output ✓");
}

// Only run the CLI when invoked directly (not when imported by the test).
if (process.argv[1] && /pseudonymize-run\.ts$/.test(process.argv[1])) {
  main();
}
