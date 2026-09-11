// Seven check groups IN THIS ORDER (see METHODOLOGY.md for the full rubric):
// TRAINING bot blocked=WARN (legitimate choice), SEARCH-INDEX or
// USER-FETCH bot blocked=FAIL, Google-Extended=INFO (token), deprecated agents
// present=WARN. The LIVE per-UA fetch is the differentiator — never cut it.
import type { ExtraBot } from "./config";
import { bestCoverage, coverageThreshold } from "./coverage";
import { parseSiteRoot } from "./crawl";
import { isBlocked, mentionsAgent, parseRobots } from "./robots";
import type { BrandModel, DomainCheck, DbWriter, Question, SitePage } from "./types";
import { safeFetch, wordPresent } from "./util";

export interface BotSpec {
  agent: string;
  kind: "training" | "search" | "user";
  impact: string;
}

// The three-bot registry (exact, current; see METHODOLOGY.md) + Bingbot
export const BOT_REGISTRY: BotSpec[] = [
  { agent: "GPTBot", kind: "training", impact: "feeds future OpenAI model weights; blocking is a legitimate choice" },
  { agent: "ClaudeBot", kind: "training", impact: "feeds future Anthropic model weights; blocking is a legitimate choice" },
  { agent: "OAI-SearchBot", kind: "search", impact: "blocking removes ChatGPT-search citation eligibility within hours-days" },
  { agent: "Claude-SearchBot", kind: "search", impact: "blocking removes Claude-search citation eligibility within hours-days" },
  { agent: "PerplexityBot", kind: "search", impact: "blocking removes Perplexity citation eligibility within hours-days" },
  { agent: "Bingbot", kind: "search", impact: "ChatGPT retrieval leans on Bing's index; blocking starves it" },
  { agent: "ChatGPT-User", kind: "user", impact: "blocking kills live page reads when ChatGPT users open your links" },
  { agent: "Claude-User", kind: "user", impact: "blocking kills live page reads when Claude users open your links" },
  { agent: "Perplexity-User", kind: "user", impact: "blocking kills live page reads when Perplexity users open your links" },
];

/** The impact sentence an extraBot gets when its config entry omits one — the
 *  same consequence wording the shipped registry uses for that class, never a
 *  claim we cannot stand behind. */
const KIND_IMPACT: Record<BotSpec["kind"], string> = {
  training: "feeds future model weights; blocking is a legitimate choice",
  search: "blocking removes this engine's citation eligibility within hours-days",
  user: "blocking kills live page reads when this engine's users open your links",
};

/** BOT_REGISTRY + saylent.config `extraBots` (config.ts). An entry whose agent
 *  matches a shipped bot (case-insensitively) REPLACES it — that is how a
 *  project reclassifies or re-words one of ours; every other entry is appended
 *  in config order. No config ⇒ BOT_REGISTRY itself, unchanged. */
export function mergeBotRegistry(extra?: ExtraBot[] | null): BotSpec[] {
  if (!extra?.length) return BOT_REGISTRY;
  const merged = BOT_REGISTRY.slice();
  for (const bot of extra) {
    const spec: BotSpec = { agent: bot.agent, kind: bot.kind, impact: bot.impact ?? KIND_IMPACT[bot.kind] };
    const at = merged.findIndex((b) => b.agent.toLowerCase() === bot.agent.toLowerCase());
    if (at >= 0) merged[at] = spec;
    else merged.push(spec);
  }
  return merged;
}

export const DEPRECATED_AGENTS = ["anthropic-ai", "Claude-Web"];
export const LIVE_FETCH_AGENTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "PerplexityBot",
  "GPTBot",
  "ClaudeBot",
];

export async function runDomainChecks(
  bm: BrandModel,
  questions: Question[],
  pages: SitePage[],
  db: DbWriter,
  runId: string,
  opts: {
    appDomain?: string;
    currentYear: number;
    fetcher?: typeof safeFetch;
    /** saylent.config `extraBots` — merged into BOT_REGISTRY for this run */
    extraBots?: ExtraBot[] | null;
    /** saylent.config `thresholds.coverage` (default COVERAGE_THRESHOLD) */
    coverageThreshold?: number | null;
  },
): Promise<DomainCheck[]> {
  // No shipped default here (SAYLENT_APP_DOMAIN / saylent.config.ts `branding`):
  // an empty appDomain just omits the "+<contact url>" suffix on the diagnostic
  // UA below, so a self-hosted deployment never advertises a domain it doesn't own.
  const { appDomain = process.env.SAYLENT_APP_DOMAIN || "", currentYear, fetcher = safeFetch } = opts;
  const registry = mergeBotRegistry(opts.extraBots);
  const coverageMin = coverageThreshold(opts.coverageThreshold);
  await db.setStage(runId, "Testing your site's gates");
  const checks: DomainCheck[] = [];
  const add = (c: DomainCheck) => checks.push(c);
  // SUBPATH HOSTING (same rule as crawlSite): a brand may live under a path
  // (`acme.com/docs`, a GitHub-Pages project site). robots.txt is fetched from the
  // HOST root because that is the only place the standard puts it; every other
  // probe hits the SITE root. `parseSiteRoot` returns the bare-domain values
  // unchanged (origin === base, prefix "/"), so bare-domain behaviour is identical.
  const { origin, base, prefix } = parseSiteRoot(bm.domain);
  const host = bm.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // What we call the audited site in user-facing detail text: the bare host for a
  // bare domain (unchanged wording), host + path for a subpath root.
  const siteLabel =
    prefix === "/" ? host : `${host}${bm.domain.replace(/^https?:\/\//, "").replace(/^[^/]*/, "").replace(/\/+$/, "")}`;

  // (a) robots.txt — parse + evaluate every bot in the registry (HOST root)
  const robotsRes = await fetcher(`${origin}/robots.txt`);
  const robotsOk = robotsRes.status >= 200 && robotsRes.status < 300 && !!robotsRes.text;
  const groups = robotsOk ? parseRobots(robotsRes.text) : [];
  if (!robotsOk) {
    add({
      check: "robots.txt",
      status: "warn",
      detail: `No readable robots.txt (status ${robotsRes.status || "unreachable"}). Engines assume allow, but you have no control surface.`,
    });
  } else {
    for (const bot of registry) {
      const blocked = isBlocked(groups, bot.agent);
      if (!blocked) {
        add({ check: `robots: ${bot.agent}`, status: "pass", detail: "allowed" });
      } else if (bot.kind === "training") {
        add({ check: `robots: ${bot.agent}`, status: "warn", detail: `blocked. ${bot.impact}`, factor: "access_blocked" });
      } else {
        add({ check: `robots: ${bot.agent}`, status: "fail", detail: `blocked. ${bot.impact}`, factor: "access_blocked" });
      }
    }
    add({
      check: "robots: Google-Extended",
      status: "info",
      detail: mentionsAgent(groups, "Google-Extended")
        ? "present. This is a Gemini-TRAINING opt-out token only; AI Overviews eligibility rides on normal Googlebot indexing."
        : "not mentioned. Note: it is a Gemini-training opt-out token only, not a crawler.",
    });
    for (const dep of DEPRECATED_AGENTS) {
      if (mentionsAgent(groups, dep)) {
        add({
          check: `robots: ${dep}`,
          status: "warn",
          detail: `"${dep}" is DEPRECATED. These rules are broken instructions no current bot reads.`,
        });
      }
    }
  }

  // (b) LIVE per-UA fetch — CDNs silently override robots.txt (the differentiator)
  for (const agent of LIVE_FETCH_AGENTS) {
    await db.setStage(runId, `Testing your site's gates · knocking as ${agent}`);
    const ua = appDomain
      ? `Mozilla/5.0 (compatible; ${agent}/1.0; +https://${appDomain}/diagnostic)`
      : `Mozilla/5.0 (compatible; ${agent}/1.0)`;
    const res = await fetcher(`${base}/`, { ua });
    const robotsAllows = !robotsOk || !isBlocked(groups, agent);
    if ([401, 403, 429].includes(res.status) && robotsAllows) {
      add({
        check: `live fetch as ${agent}`,
        status: "fail",
        detail: `HTTP ${res.status} while robots.txt allows it: a CDN/WAF "AI bots" toggle is overriding your robots.txt.`,
        factor: "access_blocked",
      });
    } else if (res.status >= 200 && res.status < 400) {
      add({ check: `live fetch as ${agent}`, status: "pass", detail: `HTTP ${res.status}` });
    } else {
      add({ check: `live fetch as ${agent}`, status: "warn", detail: `HTTP ${res.status || "unreachable"}` });
    }
  }
  if (prefix !== "/") {
    // Honesty row (subpath only — never emitted for a bare domain): the robots
    // rules above may belong to whoever owns the host root, not to this site.
    add({
      check: "robots.txt scope",
      status: "info",
      detail:
        `${siteLabel} is hosted under a path, so robots.txt was read from the host root (https://${host}/robots.txt). ` +
        "that file may be controlled by whoever owns the domain root, not by you. Serve the site from its own host or subdomain to control it.",
    });
  }
  add({
    check: "live-fetch caveat",
    status: "info",
    detail:
      "IP-verifying CDNs may treat our test differently than real bots; your server logs are ground truth.",
  });

  // HONESTY GUARD (see METHODOLOGY.md): a blanked crawl must never produce
  // confident page-level FAILs ("no schema found", "no page answers your
  // questions"). Found via a retro-analysis on a real audit: one brand's WAF
  // 403'd our old UA, the crawl was silently empty, and page-dependent checks
  // reported as if pages were seen.
  if (pages.length === 0) {
    add({
      check: "site crawl",
      status: "warn",
      detail:
        `We could not read any page on ${siteLabel}, not even via the public Internet Archive. ` +
        "A WAF/CDN is likely blocking non-browser agents; whitelisting AI and diagnostic crawlers fixes this. " +
        "Page-level checks (meta directives, schema, content coverage, entity clarity, freshness) were skipped, not failed.",
      factor: "access_blocked",
    });
    for (const c of checks) await db.saveCheck({ ...c, runId });
    return checks;
  }
  if (pages[0]?.archived) {
    add({
      check: "site crawl",
      status: "warn",
      detail:
        `Your WAF/CDN blocks declared bots, so we read ${pages.length} pages from the public Internet Archive instead ` +
        "(content may lag by days or weeks). AI crawlers announcing themselves may be blocked the same way: " +
        "whitelist them to be read live; see the live-fetch rows below.",
      factor: "access_blocked",
    });
  }

  // (c) meta directives on crawled pages (extracted at fetch time — full doc)
  for (const p of pages) {
    const robotsMeta = p.metaRobots;
    if (robotsMeta.includes("noindex")) {
      add({
        check: "meta noindex",
        status: "fail",
        detail: `${p.url} carries noindex. That kills AI-search visibility AND AI Overviews eligibility.`,
        factor: "access_blocked",
      });
    }
    if (robotsMeta.includes("nosnippet")) {
      add({
        check: "meta nosnippet",
        status: "warn",
        detail: `${p.url} carries nosnippet. Engines can index but not quote it.`,
        factor: "extractability",
      });
    }
  }

  // (d) JSON-LD scan across pages (types extracted at fetch time — full doc,
  // so schema blocks at ANY position in multi-MB pages are seen)
  const types = new Set<string>();
  for (const p of pages) for (const t of p.ldTypes) types.add(t);
  if (!types.has("organization")) {
    add({ check: "JSON-LD Organization", status: "fail", detail: "No Organization schema found on any crawled page. Engines can't resolve who you are.", factor: "schema_missing" });
  } else {
    add({ check: "JSON-LD Organization", status: "pass", detail: "present" });
  }
  for (const t of ["Product", "FAQPage"]) {
    if (!types.has(t.toLowerCase())) {
      add({ check: `JSON-LD ${t}`, status: "warn", detail: `No ${t} schema found on crawled pages.`, factor: "schema_missing" });
    } else {
      add({ check: `JSON-LD ${t}`, status: "pass", detail: "present" });
    }
  }

  // (e) coverage — one FAIL listing the top uncovered questions ("[qid] question")
  const nonBranded = questions.filter((q) => q.qtype !== "branded");
  const uncovered = nonBranded
    .map((q) => ({ q, best: bestCoverage(q.text, pages) }))
    .filter(({ best }) => best < coverageMin)
    .sort((a, b) => a.best - b.best);
  if (uncovered.length > 0) {
    add({
      check: "content coverage",
      status: "fail",
      detail:
        `No page on ${siteLabel} answers ${uncovered.length} of your ${nonBranded.length} buyer questions. Top gaps: ` +
        uncovered.slice(0, 5).map(({ q }) => `[${q.qid}] ${q.text}`).join(" · "),
      factor: "coverage_gap",
    });
  } else {
    add({ check: "content coverage", status: "pass", detail: `Every non-branded question has a matching page (threshold ${coverageMin}).` });
  }

  // (f) homepage entity clarity
  const home = pages[0];
  const categoryWord = bm.category.split(/\s+/)[0] ?? "";
  if (home && categoryWord && wordPresent(categoryWord, home.text.slice(0, 800))) {
    add({ check: "homepage entity clarity", status: "pass", detail: `"${categoryWord}" appears in the first 800 chars.` });
  } else {
    add({
      check: "homepage entity clarity",
      status: "warn",
      detail: `The homepage's first 800 chars never say "${categoryWord}". Engines must guess what ${bm.brand} is.`,
      factor: "entity_unclear",
    });
  }

  // (g) freshness — stale years in titles
  const stale = pages.find((p) => {
    const years = p.title.match(/\b(19|20)\d{2}\b/g) ?? [];
    return years.some((y) => parseInt(y, 10) <= currentYear - 2);
  });
  if (stale) {
    add({
      check: "freshness",
      status: "warn",
      detail: `Stale year in a page title: "${stale.title}". Engines discount outdated content.`,
      factor: "freshness_stale",
    });
  } else {
    add({ check: "freshness", status: "pass", detail: "No page titles carry years older than " + (currentYear - 1) + "." });
  }

  for (const c of checks) await db.saveCheck({ ...c, runId });
  return checks;
}
