// The brand page's shaping of a stored crawler report (src/lib/crawler-view.ts),
// including the AI referral block and a report stored before it existed.
import { describe, expect, it } from "vitest";
import { parseLogLine } from "@saylent/engine/access-logs";
import { CrawlerAnalytics } from "@saylent/engine/crawler-analytics";
import { crawlerReportView } from "./crawler-view";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36";
const GPTBOT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot";

function stored() {
  const a = new CrawlerAnalytics({ now: new Date("2026-11-02T00:00:00Z") });
  for (const l of [
    `203.0.113.9 - - [01/Nov/2026:10:00:00 +0000] "GET /pricing HTTP/1.1" 200 1 "-" "${GPTBOT}"`,
    `192.0.2.7 - - [01/Nov/2026:11:00:00 +0000] "GET /pricing HTTP/1.1" 200 1 "https://chatgpt.com/c/1?q=x" "${CHROME}"`,
  ]) a.add(parseLogLine(l)!);
  return a.finish({ lines: 2 });
}

describe("crawlerReportView", () => {
  it("shapes the AI referral visits next to the crawlers", () => {
    const v = crawlerReportView({ id: "r1", source_name: "access.log", created_at: "2026-11-02T00:00:00Z", report: stored() })!;
    expect(v.bots[0].label).toBe("GPTBot");
    expect(v.referrals.line).toBe("1 visit from AI assistants in 2026-11-01 to 2026-11-01 (UTC), all from ChatGPT.");
    expect(v.referrals.rows).toEqual([
      { label: "ChatGPT", visits: 1, viaReferrer: 1, viaUtmSource: 0, pages: "/pricing", receipt: expect.stringContaining("192.0.x.x") },
    ]);
    expect(v.referrals.rows[0].receipt).not.toContain("q=x");
    expect(v.referrals.note).toMatch(/floor/);
  });

  it("says a report stored before referrals were counted has no count, not zero", () => {
    const older = { ...stored(), referrals: undefined };
    const v = crawlerReportView({ id: "r0", source_name: "old.log", created_at: "2026-10-01T00:00:00Z", report: older })!;
    expect(v.referrals.rows).toEqual([]);
    expect(v.referrals.note).toBeNull();
    expect(v.referrals.line).toMatch(/not counted in this report/);
  });
});
