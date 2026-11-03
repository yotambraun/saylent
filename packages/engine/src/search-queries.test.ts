// Query fan-out: the web searches an engine ran before answering, read from
// each provider's own response fields (search-queries.ts) and kept as
// receipts. Every case here is a response shape quoted from the provider's
// API documentation (checked 2026-11-02); nothing is called.
import { describe, expect, it } from "vitest";
import {
  claudeSearchQueries,
  cleanSearchQueries,
  exposesSearchQueries,
  geminiSearchQueries,
  openaiSearchQueries,
  searchQueriesState,
} from "./search-queries";

describe("cleanSearchQueries", () => {
  it("trims, drops empties and exact repeats, keeps order, caps count and length", () => {
    expect(cleanSearchQueries(["  best uptime tool ", "", "best uptime tool", "uptime pricing", 3 as unknown as string])).toEqual([
      "best uptime tool",
      "uptime pricing",
    ]);
    const many = Array.from({ length: 40 }, (_, i) => `q${i}`);
    expect(cleanSearchQueries(many)).toHaveLength(20);
    expect(cleanSearchQueries(["x".repeat(900)])[0]).toHaveLength(300);
  });
});

describe("openaiSearchQueries (Responses API web_search_call)", () => {
  it("reads action.queries, the deprecated action.query, and only search actions", () => {
    const output = [
      { type: "reasoning" },
      { type: "web_search_call", status: "completed", action: { type: "search", queries: ["best uptime tool 2026", "uptime monitoring pricing"] } },
      { type: "web_search_call", status: "completed", action: { type: "search", query: "acme uptime reviews" } },
      { type: "web_search_call", status: "completed", action: { type: "open_page", url: "https://acme.example" } },
      { type: "web_search_call", status: "failed", action: { type: "search", query: "never ran" } },
      { type: "message", content: [] },
    ];
    expect(openaiSearchQueries(output)).toEqual(["best uptime tool 2026", "uptime monitoring pricing", "acme uptime reviews"]);
    expect(openaiSearchQueries([{ type: "message" }])).toEqual([]);
  });
});

describe("claudeSearchQueries (Messages API server_tool_use)", () => {
  it("reads web_search inputs whose result came back, not the ones that errored", () => {
    const content = [
      { type: "text", text: "I'll search." },
      { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "claude shannon birth date" } },
      { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://en.wikipedia.org/wiki/Claude_Shannon" }] },
      { type: "server_tool_use", id: "srvtoolu_2", name: "web_search", input: { query: "over the cap" } },
      { type: "web_search_tool_result", tool_use_id: "srvtoolu_2", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
      { type: "server_tool_use", id: "srvtoolu_3", name: "web_fetch", input: { url: "https://x.example" } },
    ];
    expect(claudeSearchQueries(content)).toEqual(["claude shannon birth date"]);
  });
});

describe("geminiSearchQueries (groundingMetadata.webSearchQueries)", () => {
  it("reads the first candidate's webSearchQueries; no grounding = no searches", () => {
    expect(geminiSearchQueries({ candidates: [{ groundingMetadata: { webSearchQueries: ["UEFA Euro 2024 winner"] } }] })).toEqual(["UEFA Euro 2024 winner"]);
    expect(geminiSearchQueries({ candidates: [{}] })).toEqual([]);
  });
});

describe("exposesSearchQueries and searchQueriesState", () => {
  it("knows which engines report their searches", () => {
    expect(["chatgpt", "claude", "gemini"].every(exposesSearchQueries)).toBe(true);
    expect(["perplexity", "google_ai_overview", "google_ai_mode", "copilot"].some(exposesSearchQueries)).toBe(false);
  });

  it("tells listed, none, unreported, not exposed and not recorded apart", () => {
    expect(searchQueriesState({ engine: "chatgpt", search_queries: ["a"] })).toEqual({ kind: "listed", queries: ["a"] });
    expect(searchQueriesState({ engine: "claude", search_queries: [], usage: { searches: 0 } })).toEqual({ kind: "none" });
    expect(searchQueriesState({ engine: "chatgpt", search_queries: [], usage: { searches: 2 } })).toEqual({ kind: "unreported", searches: 2 });
    expect(searchQueriesState({ engine: "perplexity", search_queries: null })).toEqual({ kind: "not_exposed" });
    expect(searchQueriesState({ engine: "gemini" })).toEqual({ kind: "not_recorded" });
  });
});
