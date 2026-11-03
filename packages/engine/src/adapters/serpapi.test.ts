// SerpApi adapter against recorded-shape fixtures (__fixtures__/serpapi, each
// following SerpApi's documented response). No network: every test injects a
// fetch that serves the fixture and records the request it was given.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADAPTERS, isNotShown } from "./index";
import { renderAnswerBlocks, orderedCitations } from "./serp";
import { SERPAPI_ENDPOINT, serpApiParams } from "./serpapi";

const FIX = path.join(__dirname, "__fixtures__", "serpapi");
const fixture = (name: string) => readFileSync(path.join(FIX, name), "utf8");

function recordingFetch(responses: { status?: number; body: string }[]) {
  const urls: URL[] = [];
  let i = 0;
  const impl = (async (input: string | URL | Request) => {
    urls.push(new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url));
    const r = responses[Math.min(i++, responses.length - 1)];
    return new Response(r.body, { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { impl, urls };
}

const cfg = (fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) => ({
  model: "serpapi:test",
  apiKey: "serp-test-key-123456",
  fetchImpl,
  locale: { country: "us", language: "en", location: "Austin, Texas, United States" },
  ...extra,
});

describe("Google AI Overviews via SerpApi", () => {
  it("reads an inline AI Overview in one request, citations in first-use order", async () => {
    const f = recordingFetch([{ body: fixture("google-inline.json") }]);
    const r = await ADAPTERS.google_ai_overview("best uptime monitoring tool", cfg(f.impl));
    expect(r.ok).toBe(true);
    expect(f.urls).toHaveLength(1);
    const u = f.urls[0];
    expect(`${u.origin}${u.pathname}`).toBe(SERPAPI_ENDPOINT);
    expect(u.searchParams.get("engine")).toBe("google");
    expect(u.searchParams.get("q")).toBe("best uptime monitoring tool");
    expect(u.searchParams.get("gl")).toBe("us");
    expect(u.searchParams.get("hl")).toBe("en");
    expect(u.searchParams.get("location")).toBe("Austin, Texas, United States");
    expect(r.text).toContain("Popular uptime monitoring tools include Upcheck and Beacon Uptime.");
    expect(r.text).toContain("## Here's a more detailed breakdown:");
    expect(r.text).toContain("- Upcheck: Free tier with 50 monitors.");
    expect(r.text).toContain("  - Paid plans from $10 a month.");
    // reference_indexes [1,0] then [1] then [2] then [3]; index 4 is listed last
    expect(r.citations.map((c) => c.url)).toEqual([
      "https://upcheck.example/pricing",
      "https://livecheck.example/uptime-tools",
      "https://reviews.example/beacon-uptime",
      "https://beacon-uptime.example/pricing",
      "https://unused.example/page",
    ]);
    expect(r.citations[0].title).toBe("Upcheck pricing");
    expect(r.usage).toEqual({ searches: 1 });
  });

  it("follows a page_token with an immediate second request (2 searches billed)", async () => {
    const f = recordingFetch([{ body: fixture("google-token.json") }, { body: fixture("ai-overview.json") }]);
    const r = await ADAPTERS.google_ai_overview("synthetic monitoring", cfg(f.impl));
    expect(r.ok).toBe(true);
    expect(f.urls).toHaveLength(2);
    expect(f.urls[1].searchParams.get("engine")).toBe("google_ai_overview");
    expect(f.urls[1].searchParams.get("page_token")).toMatch(/^rWmjgX/);
    // the token request carries no locale (the token already encodes the search)
    expect(f.urls[1].searchParams.get("gl")).toBeNull();
    expect(r.text).toBe("Kestrel Uptime and Upcheck both offer synthetic checks.");
    expect(r.citations).toEqual([{ url: "https://compare.example/synthetic", title: "Synthetic monitoring compared" }]);
    expect(r.usage).toEqual({ searches: 2 });
  });

  it("records 'not shown' (not an absence) when the page has no AI Overview, still billed", async () => {
    const f = recordingFetch([{ body: fixture("google-none.json") }]);
    const r = await ADAPTERS.google_ai_overview("plain query", cfg(f.impl));
    expect(r.ok).toBe(false);
    expect(isNotShown({ ok: r.ok, error: r.error })).toBe(true);
    expect(r.error).toMatch(/^no_answer: Google AI Overviews showed no answer/);
    expect(r.error).toContain("gl=us");
    expect(r.usage).toEqual({ searches: 1 });
  });

  it("treats the ai_overview.error form as not shown", async () => {
    const f = recordingFetch([{ body: fixture("google-error.json") }]);
    const r = await ADAPTERS.google_ai_overview("q", cfg(f.impl));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Can't generate an AI overview right now");
  });

  it("classifies a 401 as auth, never retries it, and never echoes the key", async () => {
    const f = recordingFetch([{ status: 401, body: fixture("error-401.json") }]);
    const r = await ADAPTERS.google_ai_overview("q", cfg(f.impl));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^auth: serpapi 401/);
    expect(f.urls).toHaveLength(1);
    expect(r.error).not.toContain("serp-test-key-123456");
    expect(r.usage).toBeUndefined();
  });

  it("retries a 429 (throughput cap) with backoff, then succeeds", async () => {
    const f = recordingFetch([
      { status: 429, body: JSON.stringify({ error: "Your account has run out of searches." }) },
      { body: fixture("google-inline.json") },
    ]);
    const r = await ADAPTERS.google_ai_overview("q", cfg(f.impl));
    expect(r.ok).toBe(true);
    expect(f.urls).toHaveLength(2);
  }, 10000);

  it("returns missing_key without calling the provider", async () => {
    const f = recordingFetch([{ body: "{}" }]);
    const r = await ADAPTERS.google_ai_overview("q", { model: "serpapi:x", fetchImpl: f.impl });
    expect(r.error).toBe("missing_key: KEY missing");
    expect(f.urls).toHaveLength(0);
  });
});

describe("Google AI Mode via SerpApi", () => {
  it("renders text_blocks and orders citations by first use", async () => {
    const f = recordingFetch([{ body: fixture("ai-mode.json") }]);
    const r = await ADAPTERS.google_ai_mode("best uptime monitor for a small team", cfg(f.impl));
    expect(r.ok).toBe(true);
    expect(f.urls[0].searchParams.get("engine")).toBe("google_ai_mode");
    expect(f.urls[0].searchParams.get("hl")).toBe("en");
    expect(r.text).toContain("For small teams, Upcheck is the most often recommended uptime monitor.");
    expect(r.text).toContain("- Upcheck generous free plan");
    expect(r.citations.map((c) => c.url)).toEqual([
      "https://www.reddit.com/r/sysadmin/comments/abc/uptime/",
      "https://livecheck.example/uptime-tools",
      "https://beacon-uptime.example/",
    ]);
    expect(r.usage).toEqual({ searches: 1 });
  });

  it("maps a BCP47 language to SerpApi's lowercase hl", () => {
    const p = serpApiParams("google_ai_mode", { q: "x" }, { language: "pt-BR", country: "BR" }, true, "k");
    expect(p.get("hl")).toBe("pt-br");
    expect(p.get("gl")).toBe("br");
    expect([...p.keys()].pop()).toBe("api_key");
  });
});

describe("Microsoft Copilot via SerpApi (bing_copilot)", () => {
  it("prepends the header, sends no locale params", async () => {
    const f = recordingFetch([{ body: fixture("bing-copilot.json") }]);
    const r = await ADAPTERS.copilot("uptime monitoring tools", cfg(f.impl));
    expect(r.ok).toBe(true);
    expect(f.urls[0].searchParams.get("engine")).toBe("bing_copilot");
    expect(f.urls[0].searchParams.get("gl")).toBeNull();
    expect(r.text.startsWith("Here are some well-reviewed uptime monitoring tools:")).toBe(true);
    expect(r.text).toContain("### Top picks");
    expect(r.citations.map((c) => c.url)).toEqual(["https://upcheck.example/", "https://reviews.example/beacon-uptime"]);
  });
});

describe("answer-block rendering", () => {
  it("keeps the snippet of an unknown block type", () => {
    const { text } = renderAnswerBlocks([{ type: "expandable", snippet: "Still readable." }]);
    expect(text).toBe("Still readable.");
  });

  it("drops non-http references and dedupes by normalized URL", () => {
    const c = orderedCitations(
      [
        { index: 0, link: "https://a.example/x?utm_source=g" },
        { index: 1, link: "javascript:alert(1)" },
        { index: 2, link: "https://a.example/x?utm_source=g" },
      ],
      [2, 0, 1],
    );
    expect(c).toHaveLength(1);
  });
});
