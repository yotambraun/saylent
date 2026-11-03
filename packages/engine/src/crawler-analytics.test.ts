// AI crawler analytics: the registry, every log format, gzip and JSON arrays,
// IP verification with an injected fetch + cache, redaction, caps and the run
// join. IPs come from the documentation ranges (RFC 5737 / RFC 3849); the
// "published" ranges are injected, so no test touches the network.
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { AI_BOTS, botRegistry, matchBot } from "./ai-bots";
import { cleanPath, parseAnyTime, parseLogLine, readAccessLog, splitJsonArray } from "./access-logs";
import { loadBotRanges, parseRangeFile, RangeSet } from "./bot-ip-ranges";
import { analyzeAccessLogs, CrawlerAnalytics, crawlerAlertWindow, problemKind, receiptLine, redactIp } from "./crawler-analytics";
import { BOT_REGISTRY } from "./domainChecks";

const UA = {
  gptbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot",
  chatgptUser: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  claudebot: "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  claudeSearch: "Mozilla/5.0 (compatible; Claude-SearchBot/1.0; +claudebot@anthropic.com)",
  pplx: "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36",
};

const clf = (ip: string, time: string, req: string, status: number, ua: string) =>
  `${ip} - - [${time}] "${req}" ${status} 512 "-" "${ua}"`;

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "saylent-logs-"));

describe("the bot registry", () => {
  it("matches the most specific token first and ignores ordinary browsers", () => {
    expect(matchBot(UA.chatgptUser)?.id).toBe("chatgpt-user");
    expect(matchBot(UA.gptbot)?.id).toBe("gptbot");
    expect(matchBot(UA.claudeSearch)?.id).toBe("claude-searchbot");
    expect(matchBot(UA.claudebot)?.id).toBe("claudebot");
    expect(matchBot("meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)")?.id).toBe("meta-externalagent");
    expect(matchBot(UA.chrome)).toBeNull();
    expect(matchBot("Googlebot-Image/1.0")).toBeNull();
    expect(matchBot(null)).toBeNull();
  });

  it("records a docs URL and check date for every verified entry, and flags the rest", () => {
    for (const b of AI_BOTS) {
      expect(b.checked).toBe("2026-11-02");
      if (b.verified) expect(b.docsUrl, b.id).toMatch(/^https:\/\//);
      else expect(b.note, b.id).toBeTruthy();
    }
    expect(AI_BOTS.find((b) => b.id === "google-extended")).toMatchObject({ purpose: "robots_only", tokens: [] });
    expect(AI_BOTS.find((b) => b.id === "bytespider")?.verified).toBe(false);
  });

  it("covers every bot gate-check reasons about, with the same purpose", () => {
    for (const g of BOT_REGISTRY) {
      const hit = matchBot(`Mozilla/5.0 (compatible; ${g.agent}/1.0)`);
      expect(hit, g.agent).not.toBeNull();
      if (hit!.ai) expect(hit!.purpose, g.agent).toBe(g.kind);
    }
  });

  it("appends saylent.config extraBots as custom entries", () => {
    const reg = botRegistry([{ agent: "AcmeAnswerBot", kind: "search" }]);
    expect(reg.at(-1)).toMatchObject({ id: "acmeanswerbot", operator: "custom", purpose: "search", verified: false });
  });
});

describe("parsing", () => {
  it("reads nginx/Apache combined lines, with extra trailing fields and \\x escapes", () => {
    const h = parseLogLine(`${clf("203.0.113.9", "02/Nov/2026:10:00:00 +0200", "GET /pricing?utm=x HTTP/1.1", 200, UA.gptbot)} "198.51.100.1"`)!;
    expect(h).toMatchObject({ format: "combined", ip: "203.0.113.9", method: "GET", path: "/pricing", status: 200, time: "2026-11-02T08:00:00.000Z" });
    expect(h.userAgent).toContain("GPTBot");
    expect(cleanPath("/caf\\xC3\\xA9?q=1")).toBe("/cafÃ©");
    expect(cleanPath("http://example.com/a/b?x")).toBe("/a/b");
  });

  it("reads Apache common lines, which name no bot", () => {
    const h = parseLogLine('192.0.2.1 - - [02/Nov/2026:10:00:00 +0000] "GET / HTTP/1.1" 200 12')!;
    expect(h.format).toBe("common");
    expect(h.userAgent).toBeNull();
  });

  it("reads Cloudflare NDJSON with unixnano and RFC 3339 timestamps and firewall actions", () => {
    const base = { ClientIP: "198.51.100.7", ClientRequestHost: "acme.example", ClientRequestMethod: "GET", ClientRequestURI: "/docs?a=1", ClientRequestUserAgent: UA.claudebot, EdgeResponseStatus: 403 };
    const a = parseLogLine(JSON.stringify({ ...base, EdgeStartTimestamp: 1793611200000000000, SecurityAction: "block" }))!;
    expect(a).toMatchObject({ format: "cloudflare", path: "/docs", status: 403, waf: "block", time: "2026-11-02T09:20:00.000Z" });
    const b = parseLogLine(JSON.stringify({ ...base, EdgeStartTimestamp: "2026-11-02T09:20:00Z", SecurityActions: ["managed_challenge"] }))!;
    expect(b).toMatchObject({ time: "2026-11-02T09:20:00.000Z", waf: "challenge" });
    expect(parseAnyTime(1793611200)).toBe("2026-11-02T09:20:00.000Z");
    expect(parseAnyTime(1793611200000)).toBe("2026-11-02T09:20:00.000Z");
  });

  it("reads Vercel drain records, joining the userAgent array and ignoring revalidations' -1", () => {
    const v = parseLogLine(
      JSON.stringify({ id: "1", deploymentId: "d", source: "edge", host: "acme.example", timestamp: 1793611200000, proxy: { timestamp: 1793611200000, method: "GET", host: "acme.example", path: "/blog/x?y", userAgent: [UA.pplx], statusCode: 200, clientIp: "2001:db8::5", wafAction: "deny" } }),
    )!;
    expect(v).toMatchObject({ format: "vercel", path: "/blog/x", status: 200, ip: "2001:db8::5", waf: "block" });
    expect(v.userAgent).toContain("PerplexityBot");
    const r = parseLogLine(JSON.stringify({ deploymentId: "d", statusCode: -1, path: "/x", proxy: { statusCode: -1, path: "/x", userAgent: [] } }))!;
    expect(r.status).toBeNull();
    expect(parseLogLine(JSON.stringify({ deploymentId: "d", source: "build", message: "compiling" }))).toBeNull();
    expect(parseLogLine("not a log line")).toBeNull();
  });

  it("splits a JSON array across chunk boundaries, strings with braces included", async () => {
    async function* chunks() {
      yield '[{"a":"x}{"},';
      yield '{"b":{"c":1}}';
      yield "]";
    }
    const out: string[] = [];
    for await (const o of splitJsonArray(chunks())) out.push(o);
    expect(out).toEqual(['{"a":"x}{"}', '{"b":{"c":1}}']);
  });
});

describe("streaming files", () => {
  it("reads plain, gzip and JSON-array files from a directory, counting per file", async () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "a.log"), [clf("203.0.113.1", "01/Nov/2026:00:00:00 +0000", "GET / HTTP/1.1", 200, UA.gptbot), "garbage"].join("\n"));
    writeFileSync(path.join(dir, "b.log.gz"), gzipSync(clf("203.0.113.2", "01/Nov/2026:01:00:00 +0000", "GET /a HTTP/1.1", 500, UA.claudebot)));
    writeFileSync(
      path.join(dir, "c.json"),
      JSON.stringify([{ deploymentId: "d", proxy: { method: "GET", path: "/v", userAgent: [UA.pplx], statusCode: 200, clientIp: "198.51.100.3" } }]),
    );
    writeFileSync(path.join(dir, ".hidden"), "x");
    const files: string[] = [];
    const hits = [];
    for await (const h of readAccessLog(dir, { onFile: (s) => files.push(`${path.basename(s.file)}:${s.lines}/${s.parsed}/${s.skipped}`) })) hits.push(h);
    expect(hits.map((h) => h.path)).toEqual(["/", "/a", "/v"]);
    expect(files).toEqual(["a.log:2/1/1", "b.log.gz:1/1/0", "c.json:1/1/0"]);
  });

  it("reads a JSON array from a Readable in Buffer chunks, a split UTF-8 character included", async () => {
    const body = Buffer.from(
      JSON.stringify([{ deploymentId: "d", proxy: { method: "GET", path: "/caf\u00e9", userAgent: [UA.pplx], statusCode: 200, clientIp: "198.51.100.3" } }]),
    );
    const cut = body.indexOf(Buffer.from("\u00e9")) + 1; // inside the two-byte character
    const hits = [];
    for await (const h of readAccessLog(Readable.from([body.subarray(0, cut), body.subarray(cut)]))) hits.push(h);
    expect(hits.map((h) => h.path)).toEqual(["/caf\u00e9"]);
  });

  it("reads a Readable (stdin)", async () => {
    const hits = [];
    for await (const h of readAccessLog(Readable.from([clf("192.0.2.4", "01/Nov/2026:00:00:00 +0000", "GET /x HTTP/1.1", 200, UA.pplx)]))) hits.push(h);
    expect(hits).toHaveLength(1);
  });
});

describe("IP ranges", () => {
  const file = (prefixes: string[]) => ({ creationTime: "2026-11-01T00:00:00Z", prefixes: prefixes.map((p) => (p.includes(":") ? { ipv6Prefix: p } : { ipv4Prefix: p })) });

  it("parses the published shape, bare IPs included, and checks v4/v6 membership", () => {
    const r = parseRangeFile({ ...file(["203.0.113.0/24", "2001:db8::/32"]), synctoken: "x" });
    const amazonStyle = parseRangeFile(file(["198.51.100.7"]));
    const set = new RangeSet();
    set.add(r);
    set.add(amazonStyle);
    expect(set.has("203.0.113.200")).toBe(true);
    expect(set.has("::ffff:203.0.113.5")).toBe(true);
    expect(set.has("2001:db8::1")).toBe(true);
    expect(set.has("198.51.100.7")).toBe(true);
    expect(set.has("198.51.100.8")).toBe(false);
    expect(() => parseRangeFile({})).toThrow();
  });

  it("caches for a day, falls back to a stale cache offline, and never verifies on partial data", async () => {
    const cacheDir = tmp();
    const bots = AI_BOTS.filter((b) => b.id === "gptbot" || b.id === "claudebot");
    let calls = 0;
    const fetchOk = async (url: string) => (calls++, file(url.includes("openai") ? ["203.0.113.0/24"] : ["198.51.100.0/24"]));
    const first = await loadBotRanges(bots, { cacheDir, fetch: fetchOk, now: new Date("2026-11-02T00:00:00Z") });
    expect(first.sources.map((s) => s.source)).toEqual(["live", "live"]);
    const second = await loadBotRanges(bots, { cacheDir, fetch: fetchOk, now: new Date("2026-11-02T12:00:00Z") });
    expect(second.sources.map((s) => s.source)).toEqual(["cache", "cache"]);
    expect(calls).toBe(2);
    const failing = async () => {
      throw new Error("ENOTFOUND");
    };
    const stale = await loadBotRanges(bots, { cacheDir, fetch: failing, now: new Date("2026-11-05T00:00:00Z") });
    expect(stale.sources.map((s) => s.source)).toEqual(["stale", "stale"]);
    expect(stale.ranges.get("gptbot")?.has("203.0.113.9")).toBe(true);
    const none = await loadBotRanges(bots, { cacheDir: tmp(), fetch: failing });
    expect(none.sources.every((s) => s.source === "unavailable")).toBe(true);
    expect(none.ranges.size).toBe(0);
  });
});

describe("the report", () => {
  const ranges = () => {
    const openai = new RangeSet();
    openai.add(parseRangeFile({ prefixes: [{ ipv4Prefix: "203.0.113.0/24" }] }));
    return new Map([["gptbot", openai]]);
  };
  const lines = [
    clf("203.0.113.9", "01/Nov/2026:10:00:00 +0000", "GET /pricing?token=abc HTTP/1.1", 200, UA.gptbot),
    clf("203.0.113.9", "01/Nov/2026:10:01:00 +0000", "GET /docs HTTP/1.1", 503, UA.gptbot),
    clf("192.0.2.66", "01/Nov/2026:10:02:00 +0000", "GET /pricing HTTP/1.1", 200, UA.gptbot), // spoofed: outside OpenAI's range
    clf("198.51.100.4", "02/Nov/2026:09:00:00 +0000", "GET /blog/ HTTP/1.1", 403, UA.claudebot),
    clf("198.51.100.4", "02/Nov/2026:09:00:01 +0000", "GET /missing HTTP/1.1", 404, UA.claudeSearch),
    clf("198.51.100.5", "02/Nov/2026:09:30:00 +0000", "GET / HTTP/1.1", 200, UA.googlebot),
    clf("192.0.2.10", "02/Nov/2026:09:31:00 +0000", "GET / HTTP/1.1", 200, UA.chrome),
  ];
  const run = (opts: ConstructorParameters<typeof CrawlerAnalytics>[0] = {}) => {
    const agg = new CrawlerAnalytics({ ranges: ranges(), now: new Date("2026-11-02T12:00:00Z"), ...opts });
    for (const l of lines) agg.add(parseLogLine(l)!);
    return agg;
  };

  it("counts bots by purpose, status and verification, with spoofed hits apart", () => {
    const r = run().finish({ lines: lines.length });
    expect(r.schema_version).toBe(1);
    expect(r.totals).toMatchObject({ parsed: 7, botHits: 5, aiBotHits: 4, searchBotHits: 1, verified: 2, unverified: 3, spoofed: 1, aiErrors: 1, aiBlocked: 1 });
    const gpt = r.bots.find((b) => b.id === "gptbot")!;
    expect(gpt).toMatchObject({ hits: 2, distinctPages: 2, errors: 1, verification: { verified: 2, unverified: 0 } });
    expect(r.byPurpose).toMatchObject({ training: 3, search: 2 });
    expect(r.window).toEqual({ from: "2026-11-01T10:00:00.000Z", to: "2026-11-02T09:31:00.000Z" });
    expect(r.daily.map((d) => d.date)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(r.spoofed).toHaveLength(1);
    expect(r.spoofed[0]).toMatchObject({ bot: "gptbot", ip: "192.0.x.x", hits: 1 });
    expect(r.robotsOnly.map((b) => b.id)).toContain("google-extended");
    expect(crawlerAlertWindow(r)).toEqual({ from: r.window.from, to: r.window.to, aiBotHits: 4, errors: 1, blocked: 1 });
  });

  it("lists problems with redacted receipts and no query strings", () => {
    const r = run().finish();
    expect(r.problems.map((p) => `${p.kind}:${p.path}:${p.bot}`).sort()).toEqual(["blocked:/blog:claudebot", "error:/docs:gptbot", "not_found:/missing:claude-searchbot"]);
    const all = JSON.stringify(r);
    for (const ip of ["203.0.113.9", "198.51.100.4", "192.0.2.66"]) expect(all).not.toContain(ip);
    expect(all).not.toContain("token=abc");
    expect(r.privacy).toEqual({ ipsRedacted: true, queryStringsDropped: true });
    expect(receiptLine(parseLogLine(lines[0])!)).toContain("203.0.x.x");
    expect(redactIp("2001:db8:1:2::5")).toBe("2001:db8::x");
    expect(run({ includeIps: true }).finish().problems.some((p) => p.receipts.some((x) => x.includes("198.51.100.4")))).toBe(true);
  });

  it("says when verification is off and calls nothing verified", () => {
    const r = run({ ranges: null }).finish();
    expect(r.ipVerification.mode).toBe("off");
    expect(r.ipVerification.note).toMatch(/--verify-ips/);
    expect(r.totals.verified).toBe(0);
    expect(r.totals.spoofed).toBe(0);
  });

  it("filters by window and bot", () => {
    const r = run({ since: "2026-11-02", bot: "claudebot" }).finish();
    expect(r.totals.outsideWindow).toBe(3);
    expect(r.bots.map((b) => b.id)).toEqual(["claudebot"]);
  });

  it("classifies problems from status and firewall decisions", () => {
    expect(problemKind(429, null)).toBe("blocked");
    expect(problemKind(200, "challenge")).toBe("blocked");
    expect(problemKind(502, null)).toBe("error");
    expect(problemKind(410, null)).toBe("not_found");
    expect(problemKind(400, null)).toBe("client_error");
    expect(problemKind(301, null)).toBeNull();
  });

  it("joins with a run: cited own pages, which operator fetched them, and pages never reached", () => {
    const r = run().finish({
      run: {
        runId: "run-1",
        brandDomain: "acme.example",
        answers: [
          { qid: "q01", engine: "chatgpt", ok: true, citations: [{ url: "https://www.acme.example/pricing" }, { url: "https://rival.example/x" }] },
          { qid: "q02", engine: "claude", ok: true, citations: [{ url: "https://acme.example/pricing/" }, { url: "https://acme.example/blog" }] },
          { qid: "q03", engine: "perplexity", ok: true, citations: [{ url: "https://acme.example/compare" }] },
        ],
        corpus: [{ url: "https://acme.example/pricing" }, { url: "https://acme.example/about" }],
      },
    });
    const j = r.join!;
    const pricing = j.cited.find((c) => c.path === "/pricing")!;
    expect(pricing.engines.sort()).toEqual(["chatgpt", "claude"]);
    expect(pricing.operatorFetched).toEqual({ chatgpt: true, claude: false });
    expect(pricing.aiBotHits).toBe(1);
    expect(j.citedNotFetched).toEqual(["/compare"]);
    expect(j.citedWithProblems).toEqual(["/blog"]);
    expect(j.readNotFetched).toEqual(["/about"]);
    expect(j.note).toMatch(/not a cause/);
  });

  it("analyzes a file end to end with verification from an injected fetch", async () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "access.log"), lines.join("\n"));
    const r = await analyzeAccessLogs(path.join(dir, "access.log"), {
      verifyIps: true,
      cacheDir: tmp(),
      fetch: async (url) => ({ prefixes: url.includes("gptbot") ? [{ ipv4Prefix: "203.0.113.0/24" }] : [{ ipv4Prefix: "10.0.0.0/8" }] }),
    });
    expect(r.sources[0]).toMatchObject({ lines: 7, parsed: 7, skipped: 0 });
    expect(r.ipVerification.mode).toBe("on");
    expect(r.totals.spoofed).toBeGreaterThanOrEqual(1);
  });
});
