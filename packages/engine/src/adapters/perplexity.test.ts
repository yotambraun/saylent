// This is the one hand-rolled adapter (raw fetch, not an
// SDK), so it is the one worth a network-mocked retry test: 429 then success.
import { afterEach, describe, expect, it, vi } from "vitest";
import { askPerplexity } from "./perplexity";

const okBody = JSON.stringify({
  choices: [{ message: { content: "Perplexity says hi" } }],
  citations: ["https://example.com/a"],
  search_results: [{ url: "https://example.com/a", title: "A" }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
});

describe("askPerplexity — key + retry", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns keyMissing when no apiKey is given", async () => {
    const r = await askPerplexity("q", { model: "sonar" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("missing_key: KEY missing");
  });

  it("retries once on 429 then succeeds", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response(okBody, { status: 200 }));
    const r = await askPerplexity("q", { model: "sonar", apiKey: "pk-test" });
    expect(r.ok).toBe(true);
    expect(r.text).toBe("Perplexity says hi");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  }, 10000);

  it("classifies a persistent 401 as auth and does not retry", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad key", { status: 401 }));
    const r = await askPerplexity("q", { model: "sonar", apiKey: "pk-bad" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^auth: /);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
