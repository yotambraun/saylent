// the spec (see METHODOLOGY.md) Gemini gotcha — vertexaisearch redirect citations are resolved to
// their real destination BEFORE the answer row is saved. Fetch is mocked; these
// tests NEVER hit the network.
import { describe, expect, it, vi } from "vitest";
import { isVertexRedirect, resolveRedirectCitations } from "./resolve-redirects";
import type { SafeFetchResult } from "./util";

const REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC123";
const REDIRECT2 = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/XyZ789";

/** build a mock safeFetch from a {redirectUrl → SafeFetchResult} map */
function mockFetcher(map: Record<string, SafeFetchResult>) {
  return vi.fn(async (url: string) => {
    if (url in map) return map[url];
    return { status: 0, finalUrl: url, text: "" } as SafeFetchResult;
  }) as unknown as typeof import("./util").safeFetch;
}

describe("isVertexRedirect", () => {
  it("matches vertexaisearch grounding-api-redirect links only", () => {
    expect(isVertexRedirect(REDIRECT)).toBe(true);
    expect(isVertexRedirect("https://mailforge.example/docs")).toBe(false);
    expect(isVertexRedirect("https://vertexaisearch.cloud.google.com/other")).toBe(false);
    expect(isVertexRedirect("not a url")).toBe(false);
  });
});

describe("resolveRedirectCitations", () => {
  it("resolves a vertexaisearch redirect to its final URL and keeps the title", async () => {
    const fetcher = mockFetcher({
      [REDIRECT]: { status: 200, finalUrl: "https://mailforge.example/docs/api", text: "" },
    });
    const out = await resolveRedirectCitations([{ url: REDIRECT, title: "mailforge.example" }], { fetcher });
    expect(out).toEqual([{ url: "https://mailforge.example/docs/api", title: "mailforge.example" }]);
  });

  it("passes non-redirect citations through untouched (no fetch)", async () => {
    const fetcher = mockFetcher({});
    const out = await resolveRedirectCitations([{ url: "https://mailforge.example/pricing", title: "mailforge.example" }], {
      fetcher,
    });
    expect(out).toEqual([{ url: "https://mailforge.example/pricing", title: "mailforge.example" }]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps the original redirect URL on fetch failure (status 0) — never drops the citation", async () => {
    const fetcher = mockFetcher({ [REDIRECT]: { status: 0, finalUrl: REDIRECT, text: "" } });
    const out = await resolveRedirectCitations([{ url: REDIRECT, title: "example.com" }], { fetcher });
    expect(out).toEqual([{ url: REDIRECT, title: "example.com" }]);
  });

  it("keeps the original when the chain never leaves the redirect host", async () => {
    // e.g. a 200 JS/meta-refresh page whose finalUrl is still vertexaisearch
    const fetcher = mockFetcher({ [REDIRECT]: { status: 200, finalUrl: REDIRECT, text: "<html>…</html>" } });
    const out = await resolveRedirectCitations([{ url: REDIRECT }], { fetcher });
    expect(out).toEqual([{ url: REDIRECT }]);
  });

  it("re-dedupes when two redirects resolve to the same page (normUrl)", async () => {
    const fetcher = mockFetcher({
      [REDIRECT]: { status: 200, finalUrl: "https://mailforge.example/docs/api", text: "" },
      // resolves to the same page modulo trailing slash + utm — normUrl folds them
      [REDIRECT2]: { status: 200, finalUrl: "https://mailforge.example/docs/api/?utm_source=g", text: "" },
    });
    const out = await resolveRedirectCitations(
      [
        { url: REDIRECT, title: "mailforge.example" },
        { url: REDIRECT2, title: "mailforge.example" },
      ],
      { fetcher },
    );
    expect(out).toEqual([{ url: "https://mailforge.example/docs/api", title: "mailforge.example" }]);
  });

  it("mixes resolved redirects with untouched plain citations, preserving order", async () => {
    const fetcher = mockFetcher({
      [REDIRECT]: { status: 200, finalUrl: "https://mailforge.example/blog", text: "" },
    });
    const out = await resolveRedirectCitations(
      [
        { url: "https://other.com/a", title: "other.com" },
        { url: REDIRECT, title: "mailforge.example" },
      ],
      { fetcher },
    );
    expect(out).toEqual([
      { url: "https://other.com/a", title: "other.com" },
      { url: "https://mailforge.example/blog", title: "mailforge.example" },
    ]);
  });
});
