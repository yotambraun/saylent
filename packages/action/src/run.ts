// The real (network-touching) gate check: crawlSite() + runDomainChecks() from
// @saylent/engine, called exactly the way packages/cli/src/commands/gate-check.ts's
// runGateCheckWith() does (same minimal BrandModel, same maxPages=5, same empty
// questions array) - this file does NOT reimplement any check, it only reduces the
// engine's own DomainCheck[] into a GateResult via gate-result.ts. Kept separate from
// main.ts (which reads Action inputs and writes files) so it can be exercised in a
// test with an injected fake Fetcher, the same seam run-audit.test.ts and
// gate-check.test.ts already use - a mocked global fetch would never run because
// safeFetch's SSRF/DNS-rebind guard rejects a fictional test domain first.
import type { Fetcher } from "@saylent/engine/run-audit";
import type { BrandModel } from "@saylent/engine/types";
import { computeGateResult } from "./gate-result";
import type { GateResult } from "./types";

export type EngineModule = typeof import("@saylent/engine");
export type GateCheckEngine = Pick<
  EngineModule,
  "crawlSite" | "runDomainChecks" | "MemoryDbWriter" | "BOT_REGISTRY" | "safeFetch"
>;

/** Subpath sites (`site_root` input, e.g. "/docs" for a GitHub Pages project site) -
 *  folded into the domain string the same way crawlSite/runDomainChecks' own
 *  parseSiteRoot() expects ("example.com/docs"): robots.txt still comes from the host
 *  root, only the crawl and the live probe stay inside the path. */
export function withSiteRoot(domain: string, siteRoot?: string): string {
  const trimmed = (siteRoot ?? "").trim();
  if (!trimmed) return domain;
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${domain.replace(/\/+$/, "")}${path}`;
}

export async function runGateCheck(
  engineMod: GateCheckEngine,
  domain: string,
  opts: { siteRoot?: string; fetcher?: Fetcher } = {},
): Promise<GateResult> {
  const started = Date.now();
  const target = withSiteRoot(domain, opts.siteRoot);
  const { crawlSite, runDomainChecks, MemoryDbWriter, BOT_REGISTRY } = engineMod;
  const fetcher = opts.fetcher ?? engineMod.safeFetch;

  // Same 5-page cap as `saylent gate-check` - this is the fast gate check,
  // not a full audit crawl.
  const pages = await crawlSite(target, 5, undefined, { fetcher });
  const bm: BrandModel = {
    brand: target,
    domain: target,
    aliases: [target],
    category: "",
    icp: "",
    products: [],
    value_props: [],
    problems: [],
    competitors: [],
    language: "en",
  };
  const db = new MemoryDbWriter();
  const checks = await runDomainChecks(bm, [], pages, db, "gate-check-action", {
    currentYear: new Date().getFullYear(),
    fetcher,
  });

  return computeGateResult(checks, BOT_REGISTRY, domain, Date.now() - started);
}
