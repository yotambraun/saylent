// The story lede above the Domain gates table.
// "Not crawled = not cited." is OUR paraphrase, never attributed to anyone. The
// lede composes AROUND the stored check detail — it never rewrites it.
import { describe, expect, it } from "vitest";
import { gateTally, gatesLede, robotsVsLiveNote, type GateCheck } from "./gates-lede";

const CDN_403 =
  'HTTP 403 while robots.txt allows it — a CDN/WAF "AI bots" toggle is overriding your robots.txt.';
const ROBOTS_BLOCK = "blocked — blocking removes Perplexity citation eligibility within hours-days";

const liveFetch = (agent: string, status: GateCheck["status"], detail = "HTTP 200"): GateCheck => ({
  check_name: `live fetch as ${agent}`,
  status,
  detail,
});

describe("gatesLede", () => {
  it("State 1: a live-fetch fail leads with the crawl story, detail integrated verbatim", () => {
    const lede = gatesLede(
      [
        liveFetch("GPTBot", "fail", "HTTP 403 while robots.txt allows it — training crawler blocked."),
        liveFetch("PerplexityBot", "fail", CDN_403),
        liveFetch("ChatGPT-User", "pass"),
      ],
      "mailforge.example",
    )!;
    // PerplexityBot (search) outranks GPTBot (training) as the most damning fail
    expect(lede.headline).toBe("Not crawled = not cited.");
    expect(lede.story).toBe(`We fetched mailforge.example as PerplexityBot: ${CDN_403}`);
    expect(lede.story).toContain(CDN_403);
  });

  it("State 1: prefers a search/user agent over a training crawler when both fail", () => {
    const lede = gatesLede(
      [liveFetch("ClaudeBot", "fail", "training blocked"), liveFetch("ChatGPT-User", "fail", CDN_403)],
      "mailforge.example",
    )!;
    expect(lede.story).toBe(`We fetched mailforge.example as ChatGPT-User: ${CDN_403}`);
  });

  it("State 2: no live-fetch fail but a robots block fails → the robots story", () => {
    const lede = gatesLede(
      [
        { check_name: "robots.txt", status: "warn", detail: "no readable robots.txt" },
        { check_name: "robots: PerplexityBot", status: "fail", detail: ROBOTS_BLOCK },
        liveFetch("PerplexityBot", "pass"),
      ],
      "mailforge.example",
    )!;
    expect(lede.headline).toBe("Not crawled = not cited.");
    expect(lede.story).toBe(`We read mailforge.example's robots.txt: PerplexityBot is ${ROBOTS_BLOCK}`);
    expect(lede.story).toContain(ROBOTS_BLOCK);
  });

  it("State 3: all crawl gates pass/warn → the positive 'gates open' story", () => {
    const lede = gatesLede(
      [
        { check_name: "robots: OAI-SearchBot", status: "pass", detail: "allowed" },
        liveFetch("OAI-SearchBot", "pass"),
        liveFetch("ChatGPT-User", "pass"),
        liveFetch("PerplexityBot", "pass"),
        { check_name: "freshness", status: "warn", detail: "stale year" },
      ],
      "mailforge.example",
    )!;
    expect(lede.headline).toBe("Your gates are open.");
    expect(lede.story).toBe("We knocked as 3 AI crawlers. Your site answered every one.");
  });

  it("returns null when there are no checks at all", () => {
    expect(gatesLede([], "mailforge.example")).toBeNull();
  });
});

// A file people read for years must not say "just now"; the run date travels
// with the sentence instead (item 19).
describe("gatesLede — the run date", () => {
  it("carries the date when the caller knows it", () => {
    const lede = gatesLede(
      [{ check_name: "robots: PerplexityBot", status: "fail", detail: "blocked" }],
      "acme.example",
      "09 Sept 2026",
    )!;
    expect(lede.story).toBe("We read acme.example's robots.txt on 09 Sept 2026: PerplexityBot is blocked");
  });
  it("drops the time phrase rather than lying when there is no date", () => {
    const lede = gatesLede(
      [{ check_name: "live fetch as OAI-SearchBot", status: "pass", detail: "HTTP 200" }],
      "acme.example",
    )!;
    expect(lede.story).toBe("We knocked as 1 AI crawlers. Your site answered every one.");
  });
});

describe("gateTally", () => {
  it("counts every state and adds up to the rows in the table", () => {
    const t = gateTally([
      { check_name: "a", status: "fail", detail: "" },
      { check_name: "b", status: "warn", detail: "" },
      { check_name: "c", status: "info", detail: "" },
      { check_name: "d", status: "pass", detail: "" },
      { check_name: "e", status: "pass", detail: "" },
    ]);
    expect(t.line).toBe("1 fail · 1 warn · 1 info · 2 pass");
    expect(t.fail + t.warn + t.info + t.pass).toBe(t.total);
  });
  it("drops the states with no rows", () => {
    expect(gateTally([{ check_name: "a", status: "pass", detail: "" }]).line).toBe("1 pass");
  });
});

describe("robotsVsLiveNote", () => {
  it("reconciles a robots block against a live 200 for the same agent", () => {
    const note = robotsVsLiveNote([
      { check_name: "robots: PerplexityBot", status: "fail", detail: "blocked" },
      { check_name: "live fetch as PerplexityBot", status: "pass", detail: "HTTP 200" },
    ])!;
    expect(note).toContain("PerplexityBot");
    expect(note).toContain("robots.txt tells the crawler not to ask");
  });
  it("names every agent with that pair, most damning first", () => {
    const note = robotsVsLiveNote([
      { check_name: "robots: ClaudeBot", status: "warn", detail: "blocked" },
      { check_name: "live fetch as ClaudeBot", status: "pass", detail: "HTTP 200" },
      { check_name: "robots: PerplexityBot", status: "fail", detail: "blocked" },
      { check_name: "live fetch as PerplexityBot", status: "pass", detail: "HTTP 200" },
    ])!;
    expect(note.startsWith("Both rows are true for PerplexityBot and ClaudeBot:")).toBe(true);
  });
  it("is null when no agent shows the contradiction", () => {
    expect(
      robotsVsLiveNote([
        { check_name: "robots: PerplexityBot", status: "pass", detail: "allowed" },
        { check_name: "live fetch as PerplexityBot", status: "pass", detail: "HTTP 200" },
      ]),
    ).toBeNull();
  });
});
