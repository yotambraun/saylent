import { describe, expect, it } from "vitest";
import { searchQueriesView } from "./search-queries-view";

describe("searchQueriesView", () => {
  it("lists the queries, or says plainly why there are none", () => {
    expect(searchQueriesView({ engine: "chatgpt", search_queries: ["best cdn", "cdn pricing"] })).toMatchObject({
      queries: ["best cdn", "cdn pricing"],
      note: null,
    });
    expect(searchQueriesView({ engine: "claude", search_queries: [] }).note).toBe("It answered without searching the web.");
    expect(searchQueriesView({ engine: "chatgpt", search_queries: [], usage: { searches: 1 } }).note).toBe(
      "It ran 1 web search, but the response did not include the queries.",
    );
    expect(searchQueriesView({ engine: "perplexity", search_queries: null }).note).toBe("Perplexity does not report the searches behind its answer.");
    expect(searchQueriesView({ engine: "google_ai_mode" }).note).toMatch(/does not report the searches/);
    expect(searchQueriesView({ engine: "gemini" }).note).toBe("Not recorded for this run.");
  });
});
