// The real check. Same engine code as `saylent gate-check` and the GitHub
// Action — crawlSite() + runDomainChecks() from @saylent/engine, called with
// the same minimal BrandModel and the same empty question set
// (packages/cli/src/commands/gate-check.ts, packages/action/src/run.ts). Nothing
// is reimplemented here: this file only reduces the engine's own DomainCheck[]
// into the public JSON shape in types.ts.
//
// Two deliberate differences from the CLI, both stated in
// website/content/docs/check.mdx because a user comparing the two must not be
// surprised:
//
//  1. maxPages is 3, not 5. The hosted check has a 10-second hard budget
//     (handler.ts); the CLI has none. robots.txt and the live per-UA probe are
//     byte-identical either way — only the JSON-LD/meta scan sees fewer pages,
//     so the hosted check can miss schema that lives deeper in a site.
//  2. `content coverage` and `homepage entity clarity` are dropped. Both need a
//     real brand model and a question set, which need an LLM call; with the
//     empty BrandModel a keyless check has to use, they would report a warning
//     about nothing. They belong to `saylent audit`, not here.
//
// safeFetch stays the fetcher (SSRF + DNS-rebind guard, never `allowPrivate`),
// with its per-request timeout clamped so one slow host cannot eat the budget.
import { crawlSite } from "@saylent/engine/crawl";
import { BOT_REGISTRY, runDomainChecks } from "@saylent/engine/domainChecks";
import { MemoryDbWriter } from "@saylent/engine/memory-writer";
import type { BotSpec } from "@saylent/engine/domainChecks";
import type { BrandModel, DomainCheck } from "@saylent/engine/types";
import { safeFetch } from "@saylent/engine/util";
import type {
  BotRow,
  InstantCheckResult,
  MetaSection,
  ProbeRow,
  SchemaRow,
  Verdict,
} from "./types";

/** Pages crawled per hosted check. See note 1 above. */
export const MAX_PAGES = 3;
/** Per-request outbound timeout. safeFetch's own default is 20s (and its
 *  Wayback fallback asks for 30s); neither fits a 10s budget. */
export const FETCH_TIMEOUT_MS = 5_000;

const RANK: Record<Verdict, number> = { pass: 0, warn: 1, fail: 2 };
const worst = (a: Verdict, b: Verdict): Verdict => (RANK[b] > RANK[a] ? b : a);
const worstOf = (rows: { status: Verdict }[]): Verdict =>
  rows.reduce<Verdict>((acc, r) => worst(acc, r.status), "pass");

/** "info" rows are context, never a verdict (Google-Extended is a training
 *  token, not a crawler; the live-fetch caveat; robots.txt scope). */
function asVerdict(status: DomainCheck["status"]): Verdict | null {
  return status === "info" ? null : status;
}

export type Fetcher = typeof safeFetch;

/** The engine surface this file uses — injectable so tests exercise the
 *  reduction without the network (the seam packages/action/src/run.ts uses). */
export interface GateEngine {
  crawlSite: typeof crawlSite;
  runDomainChecks: typeof runDomainChecks;
  MemoryDbWriter: typeof MemoryDbWriter;
  BOT_REGISTRY: BotSpec[];
  safeFetch: Fetcher;
}

const realEngine: GateEngine = { crawlSite, runDomainChecks, MemoryDbWriter, BOT_REGISTRY, safeFetch };

/**
 * Pure reducer: the engine's DomainCheck[] -> the public JSON payload. Every
 * status and detail string below is copied from a row the engine produced.
 */
export function toInstantCheckResult(
  checks: DomainCheck[],
  registry: BotSpec[],
  domain: string,
  pagesCrawled: number,
  elapsedMs: number,
  checkedAt: string,
): InstantCheckResult {
  const byCheck = new Map(checks.map((c) => [c.check, c]));
  const notes: string[] = [];

  // ---- robots.txt, grouped by bot class ----
  const unreadable = byCheck.get("robots.txt");
  const robotsNotes: string[] = [];
  if (unreadable) robotsNotes.push(unreadable.detail);
  const ext = byCheck.get("robots: Google-Extended");
  if (ext) robotsNotes.push(`Google-Extended: ${ext.detail}`); // a note needs its subject
  const scope = byCheck.get("robots.txt scope");
  if (scope) robotsNotes.push(scope.detail);
  for (const c of checks) {
    if (!c.check.startsWith("robots: ")) continue;
    const agent = c.check.slice("robots: ".length);
    if (agent === "Google-Extended") continue;
    if (registry.some((b) => b.agent === agent)) continue;
    // Deprecated agents (anthropic-ai, Claude-Web) — named in robots.txt but
    // no longer real crawlers. Context, not a class row.
    robotsNotes.push(`${agent}: ${c.detail}`);
  }

  const classRow = (kind: BotSpec["kind"]): BotRow[] =>
    registry
      .filter((b) => b.kind === kind)
      .map((b) => {
        const c = byCheck.get(`robots: ${b.agent}`);
        if (!c) return null;
        return { agent: b.agent, status: asVerdict(c.status) ?? "pass", detail: c.detail } satisfies BotRow;
      })
      .filter((r): r is BotRow => r !== null);

  const training = classRow("training");
  const search = classRow("search");
  const user = classRow("user");
  const robotsRows = [...training, ...search, ...user];
  const robots = {
    status: worst(worstOf(robotsRows), unreadable ? (asVerdict(unreadable.status) ?? "warn") : "pass"),
    readable: !unreadable,
    training,
    search,
    user,
    notes: robotsNotes,
  };

  // ---- live per-UA probe ----
  const probeNotes: string[] = [];
  const caveat = byCheck.get("live-fetch caveat");
  if (caveat) probeNotes.push(caveat.detail);
  const agents: ProbeRow[] = checks
    .filter((c) => c.check.startsWith("live fetch as "))
    .map((c) => {
      const http = /HTTP (\d+|unreachable)/.exec(c.detail)?.[1] ?? "unknown";
      return {
        agent: c.check.slice("live fetch as ".length),
        http,
        status: asVerdict(c.status) ?? "pass",
        detail: c.detail,
      } satisfies ProbeRow;
    });
  const probe = { status: worstOf(agents), agents, notes: probeNotes };

  // The engine's honesty guard: when no page could be read it SKIPS every
  // page-level check rather than failing it, so `checks` simply has no JSON-LD
  // and no meta rows. Reducing that to "pass" would tell a blocked site its
  // schema is fine. `checked: false` + a warn is the truthful answer: we could
  // not look. (Found by running the built function against a site we could not
  // reach — the unit tests all had pages.)
  const checked = pagesCrawled > 0;
  const unread = "Not checked — no page on the site could be read.";

  // ---- JSON-LD ----
  const types: SchemaRow[] = checks
    .filter((c) => c.check.startsWith("JSON-LD "))
    .map((c) => {
      const status = asVerdict(c.status) ?? "pass";
      return { type: c.check.slice("JSON-LD ".length), present: status === "pass", status, detail: c.detail };
    });
  const jsonld = { status: checked ? worstOf(types) : "warn", checked, types };

  // ---- meta directives ----
  const metaFindings = checks
    .filter((c) => c.check === "meta noindex" || c.check === "meta nosnippet")
    .map((c) => ({ check: c.check, status: asVerdict(c.status) ?? "pass", detail: c.detail }));
  const meta: MetaSection = {
    status: checked ? worstOf(metaFindings) : "warn",
    checked,
    noindex: metaFindings.some((f) => f.check === "meta noindex"),
    nosnippet: metaFindings.some((f) => f.check === "meta nosnippet"),
    findings: checked ? metaFindings : [{ check: "meta", status: "warn" as Verdict, detail: unread }],
  };

  // ---- everything else the engine reported that is not one of the four rows.
  // Context only: it never moves `result` (see the header note).
  for (const c of checks) {
    if (c.check === "site crawl" || (c.check === "freshness" && c.status !== "pass")) {
      notes.push(c.detail);
    }
  }

  return {
    domain,
    result: [robots, probe, jsonld, meta].reduce<Verdict>((acc, s) => worst(acc, s.status), "pass"),
    robots,
    probe,
    jsonld,
    meta,
    notes,
    checked_at: checkedAt,
    cached: false,
    elapsed_ms: elapsedMs,
    pages_crawled: pagesCrawled,
  };
}

/** safeFetch with its timeout clamped to the hosted budget. Every other guard
 *  (scheme check, private/encoded-IP rejection, DNS-rebind re-resolution, the
 *  2MB body cap, the redirect cap) is untouched — this never passes
 *  `allowPrivate`, so the SSRF guard is on for every hop. */
export function budgetedFetcher(fetcher: Fetcher, timeoutMs = FETCH_TIMEOUT_MS): Fetcher {
  return (url, opts = {}) => fetcher(url, { ...opts, timeoutMs: Math.min(opts.timeoutMs ?? timeoutMs, timeoutMs) });
}

/** The real, network-touching check. `domain` must already have been through
 *  validateDomain() — it is interpolated into URLs by the engine. */
export async function runGate(domain: string, engine: GateEngine = realEngine): Promise<InstantCheckResult> {
  const started = Date.now();
  const fetcher = budgetedFetcher(engine.safeFetch);
  const pages = await engine.crawlSite(domain, MAX_PAGES, undefined, { fetcher });
  const bm: BrandModel = {
    brand: domain,
    domain,
    aliases: [domain],
    category: "",
    icp: "",
    products: [],
    value_props: [],
    problems: [],
    competitors: [],
    language: "en",
  };
  const checks = await engine.runDomainChecks(bm, [], pages, new engine.MemoryDbWriter(), "instant-check", {
    currentYear: new Date().getFullYear(),
    fetcher,
  });
  return toInstantCheckResult(
    checks,
    engine.BOT_REGISTRY,
    domain,
    pages.length,
    Date.now() - started,
    new Date().toISOString(),
  );
}
