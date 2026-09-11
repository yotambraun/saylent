// The reduction from @saylent/engine's own DomainCheck[] to the public JSON,
// plus the fetch budget. No network: runGate() is driven through its injected
// engine seam, and the reducer is pure.
import type { BotSpec } from "@saylent/engine/domainChecks";
import type { DomainCheck, SitePage } from "@saylent/engine/types";
import { describe, expect, it, vi } from "vitest";
import { budgetedFetcher, FETCH_TIMEOUT_MS, MAX_PAGES, runGate, toInstantCheckResult } from "./gate";
import type { GateEngine } from "./gate";

const REGISTRY: BotSpec[] = [
  { agent: "GPTBot", kind: "training", impact: "feeds future model weights" },
  { agent: "OAI-SearchBot", kind: "search", impact: "removes citation eligibility" },
  { agent: "ChatGPT-User", kind: "user", impact: "kills live page reads" },
];

const CHECKS: DomainCheck[] = [
  { check: "robots: GPTBot", status: "warn", detail: "blocked — feeds future model weights" },
  { check: "robots: OAI-SearchBot", status: "pass", detail: "allowed" },
  { check: "robots: ChatGPT-User", status: "pass", detail: "allowed" },
  { check: "robots: Google-Extended", status: "info", detail: "present — a training token, not a crawler" },
  { check: "robots: Claude-Web", status: "warn", detail: "deprecated agent named in robots.txt" },
  { check: "live fetch as OAI-SearchBot", status: "pass", detail: "HTTP 200" },
  { check: "live fetch as GPTBot", status: "fail", detail: "HTTP 403" },
  { check: "live-fetch caveat", status: "info", detail: "a 200 to our UA is evidence, not proof" },
  { check: "JSON-LD Organization", status: "pass", detail: "present" },
  { check: "JSON-LD Product", status: "warn", detail: "No Product schema found on crawled pages." },
  { check: "meta nosnippet", status: "warn", detail: "https://acme.com/ carries nosnippet" },
  { check: "content coverage", status: "fail", detail: "needs a question set" },
  { check: "homepage entity clarity", status: "warn", detail: 'never says ""' },
  { check: "freshness", status: "warn", detail: 'Stale year in a page title: "Acme 2019"' },
];

function reduce(checks = CHECKS) {
  return toInstantCheckResult(checks, REGISTRY, "acme.com", 3, 1234, "2026-09-09T00:00:00.000Z");
}

describe("toInstantCheckResult", () => {
  it("groups robots.txt by bot class, verbatim from the engine's rows", () => {
    const out = reduce();
    expect(out.robots.readable).toBe(true);
    expect(out.robots.training).toEqual([
      { agent: "GPTBot", status: "warn", detail: "blocked — feeds future model weights" },
    ]);
    expect(out.robots.search.map((r) => r.agent)).toEqual(["OAI-SearchBot"]);
    expect(out.robots.user.map((r) => r.agent)).toEqual(["ChatGPT-User"]);
    expect(out.robots.status).toBe("warn");
  });

  it("keeps info rows as notes, where they cannot move a verdict", () => {
    const out = reduce();
    expect(out.robots.notes.join(" ")).toContain("Google-Extended: present"); // the note names its subject
    expect(out.robots.notes.join(" ")).toContain("training token");
    expect(out.robots.notes.join(" ")).toContain("deprecated agent");
    expect(out.probe.notes.join(" ")).toContain("evidence, not proof");
  });

  it("reads the HTTP status out of each live probe row", () => {
    const out = reduce();
    expect(out.probe.agents).toEqual([
      { agent: "OAI-SearchBot", http: "200", status: "pass", detail: "HTTP 200" },
      { agent: "GPTBot", http: "403", status: "fail", detail: "HTTP 403" },
    ]);
    expect(out.probe.status).toBe("fail");
  });

  it("reports JSON-LD presence per type and the meta directives found", () => {
    const out = reduce();
    expect(out.jsonld.types).toEqual([
      { type: "Organization", present: true, status: "pass", detail: "present" },
      { type: "Product", present: false, status: "warn", detail: "No Product schema found on crawled pages." },
    ]);
    expect(out.meta).toMatchObject({ status: "warn", noindex: false, nosnippet: true });
    expect(out.meta.findings).toHaveLength(1);
  });

  it("drops the two checks a keyless run cannot honestly make, and never lets a note change the verdict", () => {
    const out = reduce();
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain("content coverage");
    expect(serialised).not.toContain("entity clarity");
    // `content coverage` was a FAIL; the verdict is still the worst of the four rows.
    expect(out.result).toBe("fail");
    expect(out.notes.join(" ")).toContain("Stale year");
  });

  it("passes only when all four rows pass", () => {
    const clean: DomainCheck[] = [
      { check: "robots: GPTBot", status: "pass", detail: "allowed" },
      { check: "robots: OAI-SearchBot", status: "pass", detail: "allowed" },
      { check: "robots: ChatGPT-User", status: "pass", detail: "allowed" },
      { check: "live fetch as GPTBot", status: "pass", detail: "HTTP 200" },
      { check: "JSON-LD Organization", status: "pass", detail: "present" },
    ];
    expect(reduce(clean).result).toBe("pass");
  });

  it("flags an unreadable robots.txt as a warning, not a silent pass", () => {
    const out = reduce([{ check: "robots.txt", status: "warn", detail: "No readable robots.txt (status 404)" }]);
    expect(out.robots.readable).toBe(false);
    expect(out.robots.status).toBe("warn");
    expect(out.result).toBe("warn");
    expect(out.robots.notes[0]).toContain("No readable robots.txt");
  });

  it("marks JSON-LD and meta as NOT checked on an empty crawl, never a silent pass (the honesty guard)", () => {
    // packages/engine/src/domainChecks.ts returns early on pages.length === 0:
    // no JSON-LD or meta rows are ever produced, just a "site crawl" warn.
    const emptyCrawlChecks: DomainCheck[] = [
      { check: "robots: GPTBot", status: "pass", detail: "allowed" },
      { check: "robots: OAI-SearchBot", status: "pass", detail: "allowed" },
      { check: "robots: ChatGPT-User", status: "pass", detail: "allowed" },
      { check: "live fetch as GPTBot", status: "pass", detail: "HTTP 200" },
      {
        check: "site crawl",
        status: "warn",
        detail: "We could not read any page on acme.com — not even via the public Internet Archive.",
        factor: "access_blocked",
      },
    ];
    const out = toInstantCheckResult(emptyCrawlChecks, REGISTRY, "acme.com", 0, 1234, "2026-09-09T00:00:00.000Z");

    expect(out.jsonld.checked).toBe(false);
    expect(out.jsonld.types).toEqual([]);
    expect(out.jsonld.status).toBe("warn");

    expect(out.meta.checked).toBe(false);
    expect(out.meta.status).toBe("warn");
    expect(out.meta.findings).toEqual([
      { check: "meta", status: "warn", detail: "Not checked — no page on the site could be read." },
    ]);

    // Never "pass": robots + probe both passed, but the two unchecked
    // sections must still keep the overall verdict off "pass".
    expect(out.result).toBe("warn");
    expect(out.notes.join(" ")).toContain("We could not read any page on acme.com");
  });

  it("checks JSON-LD and meta normally once at least one page was read", () => {
    const out = reduce(CHECKS); // the shared fixture crawls 3 pages
    expect(out.jsonld.checked).toBe(true);
    expect(out.meta.checked).toBe(true);
  });
});

describe("budgetedFetcher", () => {
  it("clamps every outbound fetch to the hosted budget, whatever the caller asks for", async () => {
    const inner = vi.fn(async () => ({ status: 200, finalUrl: "https://acme.com/", text: "" }));
    const fetcher = budgetedFetcher(inner as unknown as GateEngine["safeFetch"]);
    await fetcher("https://acme.com/");
    await fetcher("https://acme.com/", { timeoutMs: 30_000 });
    await fetcher("https://acme.com/", { timeoutMs: 500 });
    expect(inner.mock.calls.map((c) => (c as unknown as [string, { timeoutMs: number }])[1].timeoutMs)).toEqual([
      FETCH_TIMEOUT_MS,
      FETCH_TIMEOUT_MS,
      500,
    ]);
  });

  it("never turns off the SSRF guard", async () => {
    const inner = vi.fn(async () => ({ status: 200, finalUrl: "https://acme.com/", text: "" }));
    const fetcher = budgetedFetcher(inner as unknown as GateEngine["safeFetch"]);
    await fetcher("https://acme.com/");
    const opts = (inner.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(opts.allowPrivate).toBeUndefined();
  });
});

describe("runGate", () => {
  it("crawls the hosted page budget and reduces what the engine reported", async () => {
    const pages = [{ url: "https://acme.com/" }] as unknown as SitePage[];
    const engine = {
      crawlSite: vi.fn(async () => pages),
      runDomainChecks: vi.fn(async () => CHECKS),
      MemoryDbWriter: class {},
      BOT_REGISTRY: REGISTRY,
      safeFetch: vi.fn(async () => ({ status: 200, finalUrl: "https://acme.com/", text: "" })),
    } as unknown as GateEngine;

    const out = await runGate("acme.com", engine);

    expect(engine.crawlSite).toHaveBeenCalledWith("acme.com", MAX_PAGES, undefined, expect.anything());
    expect(out.domain).toBe("acme.com");
    expect(out.pages_crawled).toBe(1);
    expect(out.cached).toBe(false);
    expect(out.result).toBe("fail");
    expect(Date.parse(out.checked_at)).not.toBeNaN();
    // The empty question set + empty brand model the engine is handed.
    const [bm, questions] = (engine.runDomainChecks as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(questions).toEqual([]);
    expect(bm).toMatchObject({ domain: "acme.com", category: "" });
  });

  it("never reports pass on a crawl that came back empty", async () => {
    const engine = {
      crawlSite: vi.fn(async () => []),
      runDomainChecks: vi.fn(async () => [
        { check: "robots: GPTBot", status: "pass", detail: "allowed" },
        {
          check: "site crawl",
          status: "warn",
          detail: "We could not read any page on acme.com — not even via the public Internet Archive.",
          factor: "access_blocked",
        },
      ] as DomainCheck[]),
      MemoryDbWriter: class {},
      BOT_REGISTRY: REGISTRY,
      safeFetch: vi.fn(async () => ({ status: 403, finalUrl: "https://acme.com/", text: "" })),
    } as unknown as GateEngine;

    const out = await runGate("acme.com", engine);

    expect(out.pages_crawled).toBe(0);
    expect(out.jsonld.checked).toBe(false);
    expect(out.meta.checked).toBe(false);
    expect(out.result).not.toBe("pass");
  });
});
