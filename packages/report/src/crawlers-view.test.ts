// The shared sentences and crawlers.md over reports built from parsed lines.
import { describe, expect, it } from "vitest";
import { parseLogLine } from "@saylent/engine/access-logs";
import { CrawlerAnalytics } from "@saylent/engine/crawler-analytics";
import { crawlersLede, problemsLine, referralsLine, renderCrawlersMarkdown, verificationLine } from "./crawlers-view";

const line = (ip: string, path: string, status: number, ua: string, t = "01/Nov/2026:10:00:00 +0000") =>
  `${ip} - - [${t}] "GET ${path} HTTP/1.1" ${status} 1 "-" "${ua}"`;

function report(lines: string[]) {
  const a = new CrawlerAnalytics({ now: new Date("2026-11-02T00:00:00Z") });
  for (const l of lines) {
    const h = parseLogLine(l);
    if (h) a.add(h);
  }
  return a.finish({ lines: lines.length });
}

describe("crawlers view", () => {
  it("says plainly when no AI crawler came", () => {
    const r = report([line("192.0.2.1", "/", 200, "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")]);
    expect(crawlersLede(r)).toBe("No AI crawler visited in 1 request from 2026-11-01 to 2026-11-01 (UTC). Googlebot and Bingbot made 1 request.");
    expect(problemsLine(r)).toBeNull();
    expect(verificationLine(r)).toMatch(/IP verification is off/);
  });

  it("names the busiest AI crawler only when it leads alone", () => {
    const gpt = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot";
    const claude = "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)";
    const lead = report([line("192.0.2.1", "/a", 200, gpt), line("192.0.2.1", "/b", 200, gpt), line("192.0.2.2", "/a", 200, claude)]);
    expect(crawlersLede(lead)).toContain("; GPTBot the most, 2 requests to 2 pages.");
    const tie = report([line("192.0.2.1", "/a", 200, gpt), line("192.0.2.2", "/a", 200, claude)]);
    expect(crawlersLede(tie)).not.toContain("the most");
  });

  it("words AI referral visits, a tie, none, and a report made before they were counted", () => {
    const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36";
    const visit = (path: string, ref: string) => `192.0.2.9 - - [01/Nov/2026:10:00:00 +0000] "GET ${path} HTTP/1.1" 200 1 "${ref}" "${chrome}"`;
    const lead = report([visit("/a", "https://chatgpt.com/"), visit("/b?utm_source=chatgpt.com", "-"), visit("/a", "https://www.perplexity.ai/")]);
    expect(referralsLine(lead)).toBe("3 visits from AI assistants in 2026-11-01 to 2026-11-01 (UTC), ChatGPT the most (2).");
    const md = renderCrawlersMarkdown(lead);
    expect(md).toContain("## Visits from AI assistants");
    expect(md).toContain("| ChatGPT | 2 | 1 | 1 | /a (1), /b (1) | 2026-11-01 |");
    expect(md).toMatch(/a floor, not a total/);
    const tie = report([visit("/a", "https://chatgpt.com/"), visit("/a", "https://claude.ai/")]);
    expect(referralsLine(tie)).toBe("2 visits from AI assistants in 2026-11-01 to 2026-11-01 (UTC), from 2 assistants.");
    const one = report([visit("/a", "https://claude.ai/")]);
    expect(referralsLine(one)).toMatch(/1 visit from AI assistants .*, all from Claude\.$/);
    expect(referralsLine(report([visit("/a", "https://www.google.com/")]))).toMatch(/^No visit in .* came with an AI assistant's referrer or utm_source\.$/);
    const old = { ...lead, referrals: undefined };
    expect(referralsLine(old)).toMatch(/not counted in this report/);
    expect(renderCrawlersMarkdown(old)).not.toContain("| ChatGPT |");
  });

  it("says when nothing in the file was a readable log", () => {
    const r = report([]);
    expect(crawlersLede(r)).toMatch(/^No line in 0 lines was a log format/);
  });

  it("renders crawlers.md with bots, problems and a receipt, no raw IP", () => {
    const r = report([
      line("203.0.113.9", "/docs", 503, "GPTBot/1.4"),
      line("203.0.113.9", "/docs", 503, "GPTBot/1.4"),
      line("198.51.100.4", "/", 200, "PerplexityBot/1.0"),
    ]);
    expect(problemsLine(r)).toBe("AI crawlers met 2 server errors; each problem below carries the log lines.");
    const md = renderCrawlersMarkdown(r);
    expect(md).toContain("# AI crawlers");
    expect(md).toContain("| GPTBot | Training | 2 | 1 |");
    expect(md).toContain("- **/docs** · GPTBot · Server error (5xx) · 2 requests (503 x2)");
    expect(md).toContain("203.0.x.x");
    expect(md).not.toContain("203.0.113.9");
    expect(md).toContain("robots.txt-only tokens (never in a log): Google-Extended, Applebot-Extended.");
  });
});
