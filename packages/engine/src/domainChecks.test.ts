// Subpath site roots in the domain checks (see the planted-gap
// finding in examples/brand-site/PLANTED-GAPS.md): a brand hosted under a path
// (`acme.com/docs`) must have robots.txt read from the HOST root — where the
// standard puts it — while the live per-UA probe hits the SITE root. Bare-domain
// behaviour must stay byte-identical, which the first block pins URL by URL.
// Fetch is mocked via the injectable fetcher (same pattern as crawl.test.ts);
// these tests NEVER hit the network.
import { describe, expect, it, vi } from "vitest";
import { BOT_REGISTRY, LIVE_FETCH_AGENTS, mergeBotRegistry, runDomainChecks } from "./domainChecks";
import { MemoryDbWriter } from "./memory-writer";
import type { BrandModel, Question, SitePage } from "./types";
import type { SafeFetchResult } from "./util";

const ROBOTS = "User-agent: *\nAllow: /\n";

/** record every requested URL; 200 for robots.txt + any site root, 404 otherwise */
function recordingFetcher(urls: string[]) {
  return vi.fn(async (url: string) => {
    urls.push(url);
    if (url.endsWith("/robots.txt")) {
      return { status: 200, finalUrl: url, text: ROBOTS } as SafeFetchResult;
    }
    return { status: 200, finalUrl: url, text: "<html></html>" } as SafeFetchResult;
  }) as unknown as typeof import("./util").safeFetch;
}

const bm = (domain: string): BrandModel => ({
  brand: "Acme",
  domain,
  aliases: [],
  category: "monitoring tool",
  icp: "ops teams",
  products: [],
  value_props: [],
  problems: [],
  competitors: [],
  language: "en",
});

const questions: Question[] = [{ qid: "q1", text: "best monitoring tool", qtype: "category" }];

const page = (url: string): SitePage => ({
  url,
  status: 200,
  title: "Acme — monitoring tool",
  text: "acme is a monitoring tool ".repeat(40),
  ldTypes: ["organization"],
  metaRobots: "",
  links: [],
});

async function run(
  domain: string,
  pages: SitePage[],
  extra: { extraBots?: import("./config").ExtraBot[]; coverageThreshold?: number | null } = {},
) {
  const urls: string[] = [];
  const db = new MemoryDbWriter();
  const checks = await runDomainChecks(bm(domain), questions, pages, db, "run1", {
    appDomain: "",
    currentYear: 2026,
    fetcher: recordingFetcher(urls),
    ...extra,
  });
  return { urls, checks };
}

describe("runDomainChecks — bare domain (regression: byte-identical)", () => {
  it("reads robots.txt and probes the live UAs at the bare host root", async () => {
    const { urls, checks } = await run("acme.com", [page("https://acme.com/")]);

    expect(urls[0]).toBe("https://acme.com/robots.txt");
    expect(urls.slice(1)).toEqual(LIVE_FETCH_AGENTS.map(() => "https://acme.com/"));
    // no subpath-only row is ever emitted for a bare domain
    expect(checks.some((c) => c.check === "robots.txt scope")).toBe(false);
  });

  it("keeps the bare host in the user-facing detail text", async () => {
    const { checks } = await run("acme.com", []);
    const crawl = checks.find((c) => c.check === "site crawl");
    expect(crawl?.detail).toContain("We could not read any page on acme.com, not even");
  });

  it("strips a scheme exactly as before", async () => {
    const { urls } = await run("https://acme.com", [page("https://acme.com/")]);
    expect(urls[0]).toBe("https://acme.com/robots.txt");
    expect(urls[1]).toBe("https://acme.com/");
  });
});

describe("runDomainChecks — subpath site root", () => {
  it("reads robots.txt from the HOST root and probes the SITE root", async () => {
    const { urls } = await run("acme.com/docs", [page("https://acme.com/docs/")]);

    expect(urls[0]).toBe("https://acme.com/robots.txt");
    expect(urls.slice(1)).toEqual(LIVE_FETCH_AGENTS.map(() => "https://acme.com/docs/"));
  });

  it("accepts a full URL with a trailing slash and does not double it", async () => {
    const { urls } = await run("https://acme.com/docs/", [page("https://acme.com/docs/")]);
    expect(urls[0]).toBe("https://acme.com/robots.txt");
    expect(urls[1]).toBe("https://acme.com/docs/");
  });

  it("adds one honest INFO row saying whose robots.txt was read", async () => {
    const { checks } = await run("acme.com/docs", [page("https://acme.com/docs/")]);
    const scope = checks.find((c) => c.check === "robots.txt scope");
    expect(scope?.status).toBe("info");
    expect(scope?.detail).toContain("acme.com/docs is hosted under a path");
    expect(scope?.detail).toContain("https://acme.com/robots.txt");
  });

  it("names the site root (host + path) in the coverage and empty-crawl details", async () => {
    const { checks } = await run("acme.com/docs", []);
    expect(checks.find((c) => c.check === "site crawl")?.detail).toContain(
      "any page on acme.com/docs, not even",
    );

    const offTopic = {
      ...page("https://acme.com/docs/"),
      title: "Acme",
      text: "lorem ipsum dolor ".repeat(40),
    };
    const covered = await run("acme.com/docs", [offTopic]);
    const coverage = covered.checks.find((c) => c.check === "content coverage");
    expect(coverage?.status).toBe("fail");
    expect(coverage?.detail).toContain("No page on acme.com/docs answers");
  });

  it("JSON-LD checks still read the crawled site-root pages, not the host root", async () => {
    // crawlSite already keeps a subpath crawl inside its prefix; the schema scan
    // is page-derived, so a subpath run sees the subpath site's schema.
    const { checks } = await run("acme.com/docs", [page("https://acme.com/docs/")]);
    const org = checks.find((c) => c.check === "JSON-LD Organization");
    expect(org?.status).toBe("pass");
  });
});

describe("mergeBotRegistry (saylent.config extraBots)", () => {
  it("no extraBots ⇒ the shipped BOT_REGISTRY, unchanged", () => {
    expect(mergeBotRegistry(undefined)).toBe(BOT_REGISTRY);
    expect(mergeBotRegistry([])).toBe(BOT_REGISTRY);
  });

  it("appends a new bot with its own impact sentence", () => {
    const merged = mergeBotRegistry([{ agent: "MyCrawlerBot", kind: "search", impact: "custom impact" }]);
    expect(merged).toHaveLength(BOT_REGISTRY.length + 1);
    expect(merged.at(-1)).toEqual({ agent: "MyCrawlerBot", kind: "search", impact: "custom impact" });
  });

  it("fills a default impact sentence by kind when the config entry omits one", () => {
    const merged = mergeBotRegistry([{ agent: "MyCrawlerBot", kind: "user" }]);
    expect(merged.at(-1)?.impact).toMatch(/live page reads/);
  });

  it("replaces a shipped bot (case-insensitive match on agent) instead of duplicating it", () => {
    const merged = mergeBotRegistry([{ agent: "gptbot", kind: "training", impact: "reclassified" }]);
    expect(merged).toHaveLength(BOT_REGISTRY.length);
    const gptbot = merged.find((b) => b.agent.toLowerCase() === "gptbot");
    expect(gptbot).toEqual({ agent: "gptbot", kind: "training", impact: "reclassified" });
  });
});

describe("runDomainChecks — extraBots + thresholds.coverage (saylent.config)", () => {
  it("checks robots.txt against the merged registry, including the extra bot", async () => {
    const { checks } = await run("acme.com", [page("https://acme.com/")], {
      extraBots: [{ agent: "MyCrawlerBot", kind: "search" }],
    });
    expect(checks.some((c) => c.check === "robots: MyCrawlerBot")).toBe(true);
  });

  it("a tighter coverage threshold can turn a pass into a fail, and is named in the detail text", async () => {
    // "best monitoring tool" against this page scores exactly 0.5 (bestCoverage) —
    // above the calibrated default (0.45, pass) but below a strict 0.6 (fail).
    const offTopic = {
      ...page("https://acme.com/"),
      title: "Acme dashboards",
      text: "monitoring dashboards for ops teams ".repeat(20),
    };
    const loose = await run("acme.com", [offTopic]);
    expect(loose.checks.find((c) => c.check === "content coverage")?.status).toBe("pass");

    const strict = await run("acme.com", [offTopic], { coverageThreshold: 0.6 });
    const strictCheck = strict.checks.find((c) => c.check === "content coverage");
    expect(strictCheck?.status).toBe("fail");
  });

  it("an out-of-range coverage threshold is ignored (falls back to the calibrated default)", async () => {
    const { checks } = await run("acme.com", [page("https://acme.com/")], { coverageThreshold: 5 });
    expect(checks.find((c) => c.check === "content coverage")?.detail).toContain("threshold 0.45");
  });
});
