// AI referral visits from access logs: the assistant list (ai-referrers.ts),
// the Referer and utm_source read at parse time (access-logs.ts) and the
// counts in a CrawlerReport (crawler-analytics.ts). Fixture lines only.
import { describe, expect, it } from "vitest";
import { AI_ASSISTANTS, aiReferral } from "./ai-referrers";
import { parseLogLine, refererHostOf, utmSourceOf } from "./access-logs";
import { CrawlerAnalytics, receiptLine } from "./crawler-analytics";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36";
const GPTBOT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot";
const line = (time: string, req: string, referer: string, ua = CHROME, ip = "192.0.2.10") =>
  `${ip} - - [${time}] "${req}" 200 512 "${referer}" "${ua}"`;

describe("the assistant list", () => {
  it("is one data list with unique ids and lowercase bare hosts", () => {
    const ids = AI_ASSISTANTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of AI_ASSISTANTS) for (const h of a.hosts) expect(h).toMatch(/^[a-z0-9.-]+$/);
  });

  it("matches a Referer host or subdomain, then a utm_source naming a host", () => {
    expect(aiReferral("chatgpt.com", null)).toMatchObject({ assistant: { id: "chatgpt" }, via: "referrer" });
    expect(aiReferral("www.perplexity.ai", null)).toMatchObject({ assistant: { id: "perplexity" }, via: "referrer" });
    expect(aiReferral("gemini.google.com", null)).toMatchObject({ assistant: { id: "gemini" } });
    expect(aiReferral("copilot.com", null)).toMatchObject({ assistant: { id: "copilot" } });
    expect(aiReferral(null, "chatgpt.com")).toMatchObject({ assistant: { id: "chatgpt" }, via: "utm_source" });
    expect(aiReferral("www.google.com", null)).toBeNull();
    expect(aiReferral("notchatgpt.com", null)).toBeNull();
    expect(aiReferral(null, "newsletter")).toBeNull();
  });
});

describe("reading Referer and utm_source", () => {
  it("keeps only the Referer host and the utm_source value", () => {
    expect(refererHostOf("https://chatgpt.com/c/abc?q=secret")).toBe("chatgpt.com");
    expect(refererHostOf("-")).toBeNull();
    expect(refererHostOf("not a url")).toBeNull();
    expect(utmSourceOf("/pricing?utm_source=ChatGPT.com&token=x")).toBe("chatgpt.com");
    expect(utmSourceOf("/pricing")).toBeNull();
  });

  it("reads them from combined, Cloudflare and Vercel lines; the path still has no query", () => {
    const c = parseLogLine(line("02/Nov/2026:10:00:00 +0000", "GET /pricing?utm_source=chatgpt.com HTTP/1.1", "https://chatgpt.com/"))!;
    expect(c).toMatchObject({ path: "/pricing", refererHost: "chatgpt.com", utmSource: "chatgpt.com" });
    const cf = parseLogLine(
      JSON.stringify({ ClientIP: "192.0.2.1", ClientRequestURI: "/a?utm_source=perplexity.ai", ClientRequestPath: "/a", ClientRequestReferer: "https://www.perplexity.ai/search/x", ClientRequestUserAgent: CHROME, EdgeResponseStatus: 200, EdgeStartTimestamp: "2026-11-02T09:00:00Z" }),
    )!;
    expect(cf).toMatchObject({ path: "/a", refererHost: "www.perplexity.ai", utmSource: "perplexity.ai" });
    const v = parseLogLine(
      JSON.stringify({ deploymentId: "dpl_1", proxy: { timestamp: 1793611200000, method: "GET", host: "acme.example", path: "/b?utm_source=x", userAgent: [CHROME], referer: "https://claude.ai/chat/1", statusCode: 200 } }),
    )!;
    expect(v).toMatchObject({ path: "/b", refererHost: "claude.ai", utmSource: "x" });
    const common = parseLogLine('192.0.2.1 - - [02/Nov/2026:10:00:00 +0000] "GET /?utm_source=chatgpt.com HTTP/1.1" 200 12')!;
    expect(common).toMatchObject({ refererHost: null, utmSource: "chatgpt.com" });
  });
});

describe("referrals in the report", () => {
  const lines = [
    line("01/Nov/2026:10:00:00 +0000", "GET /pricing HTTP/1.1", "https://chatgpt.com/c/123?q=private"),
    line("01/Nov/2026:11:00:00 +0000", "GET /pricing?utm_source=chatgpt.com HTTP/1.1", "-"),
    line("02/Nov/2026:09:00:00 +0000", "GET /docs HTTP/1.1", "https://www.perplexity.ai/search/abc"),
    line("02/Nov/2026:09:01:00 +0000", "GET /docs HTTP/1.1", "https://www.google.com/"),
    line("02/Nov/2026:09:02:00 +0000", "GET /assets/app.js HTTP/1.1", "https://acme.example/docs"),
    // a bot claiming an AI referrer is a bot, not a visit
    line("02/Nov/2026:09:03:00 +0000", "GET /pricing HTTP/1.1", "https://chatgpt.com/", GPTBOT, "203.0.113.9"),
  ];
  const report = () => {
    const agg = new CrawlerAnalytics({ now: new Date("2026-11-02T12:00:00Z") });
    for (const l of lines) agg.add(parseLogLine(l)!);
    return agg.finish({ lines: lines.length });
  };

  it("counts visits per assistant by Referer or utm_source, browsers only, with redacted receipts", () => {
    const r = report();
    if (!r.referrals) throw new Error("no referrals block");
    expect(r.referrals.visits).toBe(3);
    const chat = r.referrals.assistants.find((a) => a.id === "chatgpt")!;
    expect(chat).toMatchObject({ label: "ChatGPT", operator: "OpenAI", visits: 2, viaReferrer: 1, viaUtmSource: 1, firstSeen: "2026-11-01T10:00:00.000Z", lastSeen: "2026-11-01T11:00:00.000Z" });
    expect(chat.pages).toEqual([{ path: "/pricing", visits: 2 }]);
    expect(chat.receipts[0]).toContain("192.0.x.x");
    expect(chat.receipts.join(" ")).not.toContain("private");
    expect(r.referrals.assistants.map((a) => a.id)).toEqual(["chatgpt", "perplexity"]);
    expect(r.referrals.note).toMatch(/floor/);
    // the bot's line is counted as a bot hit and not as a visit
    expect(r.totals.aiBotHits).toBe(1);
  });

  it("receipts cut the Referer's query string too", () => {
    expect(receiptLine(parseLogLine(lines[0])!)).toContain('"https://chatgpt.com/c/123?…"');
  });
});
