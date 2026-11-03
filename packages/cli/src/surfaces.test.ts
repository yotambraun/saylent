// Answer surfaces and source intelligence on the CLI, $0: engine planning,
// the surface locale, the preflight/summary lines, `saylent sources`, the MCP
// `sources` tool against the shipped Kestrel bundle, and the SerpApi key test.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as engineMod from "@saylent/engine";
import { describe, expect, it } from "vitest";
import { mapProviderError, parseAdapterError } from "./errors";
import { testProviderKey } from "./key-test";
import { formatHistory, formatSources } from "./commands/sources";
import { querySources, sourcesDigest } from "./mcp/sources";
import { hasEngineFailures, surfacesMeta } from "./run";
import {
  hasKeyFor,
  missingSurfaceKeyMessage,
  planEngines,
  resolveSurfaceLocale,
  sourcesSummaryLines,
  surfacesLine,
} from "./surfaces";

const here = path.dirname(fileURLToPath(import.meta.url));
const KESTREL = path.join(here, "../../../examples/kestrel/run.json");
const kestrel = () => engineMod.readBundle(JSON.parse(readFileSync(KESTREL, "utf8")));

describe("planEngines", () => {
  it("defaults to the four model engines; --surfaces adds, never replaces", () => {
    const p = planEngines(undefined, ["google_ai_overview"], { openai: "k", serpapi: "s" });
    expect(p.requested).toEqual(["chatgpt", "claude", "gemini", "perplexity", "google_ai_overview"]);
    expect(p.available).toEqual(["chatgpt", "google_ai_overview"]);
    expect(p.surfacesWithoutKey).toEqual([]);
  });
  it("names a requested surface that has no SerpApi key", () => {
    const p = planEngines(["chatgpt", "google_ai_mode"], ["copilot"], { openai: "k" });
    expect(p.available).toEqual(["chatgpt"]);
    expect(p.surfacesWithoutKey).toEqual(["google_ai_mode", "copilot"]);
    expect(missingSurfaceKeyMessage(p.surfacesWithoutKey)).toContain("Google AI Mode, Microsoft Copilot need a SerpApi key (SERPAPI_API_KEY)");
    expect(hasKeyFor("copilot", { serpapi: "s" })).toBe(true);
  });
});

describe("surface locale", () => {
  it("flag > config, language follows the run locale unless config sets it", () => {
    expect(resolveSurfaceLocale({ country: "DE", locale: "de", config: { country: "us", location: "Berlin" } })).toEqual({
      country: "de",
      language: "de",
      location: "Berlin",
    });
    expect(resolveSurfaceLocale({ locale: "de", config: { language: "en" } })).toEqual({ language: "en" });
    expect(() => resolveSurfaceLocale({ country: "germany" })).toThrow(/two-letter country code/);
  });
  it("the preflight line names the provider, the locale and the per-search price", () => {
    const line = surfacesLine(["chatgpt", "google_ai_overview", "copilot"], { country: "us", language: "en" })!;
    expect(line).toContain("Google AI Overviews, Microsoft Copilot via SerpApi");
    expect(line).toContain("country us");
    expect(line).toContain("2.5c/search");
    expect(line).toContain("Microsoft Copilot takes no locale");
    expect(surfacesLine(["chatgpt"], null)).toBeNull();
  });
  it("run.json stamps run.surfaces only when a surface was asked", () => {
    expect(surfacesMeta(["chatgpt"], { country: "us" })).toBeNull();
    expect(surfacesMeta(["chatgpt", "google_ai_mode"], { country: "us" })).toEqual({ provider: "serpapi", locale: { country: "us" } });
  });
});

describe("not-shown answers", () => {
  it("never flip the exit code and get their own sentence", () => {
    const notShown = { engine: "google_ai_overview" as const, ok: false, error: "no_answer: Google AI Overviews showed no answer (x)" };
    expect(hasEngineFailures(["google_ai_overview"], [notShown])).toBe(false);
    expect(hasEngineFailures(["google_ai_overview"], [{ ...notShown, error: "auth: 401" }])).toBe(true);
    expect(parseAdapterError(notShown.error).kind).toBe("no_answer");
    expect(mapProviderError("google_ai_overview", "rate_limit: serpapi 429")).toContain("SerpApi refused more searches");
    expect(mapProviderError("copilot", "missing_key: KEY missing")).toContain("saylent keys set serpapi");
  });
});

describe("sources on the Kestrel bundle", () => {
  const bundle = kestrel();
  it("the MCP query recomputes when the bundle has no sources block, with receipts and quotes", () => {
    const r = querySources(bundle, { view: "opportunities", limit: 3 }) as unknown as { recomputed: boolean; opportunities: { receipts: { answer_excerpt: string; question: string }[] }[] };
    expect(r.recomputed).toBe(true);
    expect(r.opportunities).toHaveLength(3);
    expect(r.opportunities[0].receipts[0].answer_excerpt.length).toBeGreaterThan(0);
    expect(r.opportunities[0].receipts[0].question.length).toBeGreaterThan(0);
  });
  it("uses a stored block of a known schema as-is", () => {
    const withBlock = engineMod.withSources(bundle);
    expect(querySources(withBlock, {}).recomputed).toBe(false);
  });
  it("filters by engine and type, and refuses an engine the run never asked", () => {
    const r = querySources(bundle, { view: "domains", type: "rival_site", limit: 50 }) as unknown as { domains: { type: string }[] };
    expect(r.domains.length).toBeGreaterThan(0);
    for (const d of r.domains) expect(d.type).toBe("rival_site");
    expect(() => querySources(bundle, { engine: "google_ai_mode" })).toThrow(/no answers from "google_ai_mode"/);
  });
  it("one domain's detail lists every answer citing it", () => {
    const r = querySources(bundle, { domain: "www.upcheck.example" }) as unknown as { domain_detail: { host: string; answers: unknown[] } };
    expect(r.domain_detail.host).toBe("upcheck.example");
    expect(r.domain_detail.answers.length).toBeGreaterThan(0);
  });
  it("prints text and a two-run history", () => {
    const text = formatSources(bundle, { limit: 3 });
    expect(text).toContain("Off-site opportunities");
    expect(text).toContain("204 citations");
    const hist = formatHistory([bundle, bundle]);
    expect(hist).toContain("2 runs");
    expect(hist).toContain("upcheck.example");
  });
  it("the finish summary and the audit digest are counts only", () => {
    const intel = engineMod.bundleSources(bundle);
    const lines = sourcesSummaryLines(intel);
    expect(lines[0]).toMatch(/^ {2}Sources {3}204 citations/);
    expect(lines[1]).toMatch(/Off-site +\d+ opportunit/);
    expect(sourcesDigest(intel).opportunities.length).toBeLessThanOrEqual(3);
    expect(sourcesSummaryLines(null)).toEqual([]);
  });
});

describe("SerpApi key test", () => {
  it("uses the free Account API and reports searches left", async () => {
    let url = "";
    const fetchImpl = (async (u: unknown) => {
      url = String(u);
      return new Response(JSON.stringify({ total_searches_left: 240 }), { status: 200 });
    }) as typeof fetch;
    const r = await testProviderKey("serpapi", "abc123def456", fetchImpl);
    const sent = new URL(url);
    expect(sent.origin + sent.pathname).toBe("https://serpapi.com/account.json");
    expect(sent.searchParams.get("api_key")).toBe("abc123def456");
    expect(r).toEqual({ provider: "serpapi", ok: true, detail: "valid, 240 searches left" });
  });
  it("a 401 is invalid", async () => {
    const r = await testProviderKey("serpapi", "bad-key-123", (async () => new Response(null, { status: 401 })) as typeof fetch);
    expect(r.ok).toBe(false);
  });
});
