// Colocated tests for the pure citation-URL logic behind the citations table
// (migration 0032). Covers normUrl parity, archive unwrap, and the Gemini
// vertexaisearch redirect host-derivation (title fallback) seen in real dev data.
import { describe, expect, it } from "vitest";
import { citationHost, normUrl, unwrapArchiveUrl } from "./citation-url";

describe("normUrl", () => {
  it("lowercases scheme + host and strips the fragment", () => {
    expect(normUrl("HTTPS://Example.COM/Path#frag")).toBe("https://example.com/Path");
  });
  it("strips utm_/ref/fbclid/gclid tracking params, keeps others", () => {
    expect(normUrl("https://x.com/p?utm_source=a&ref=b&fbclid=c&gclid=d&keep=1")).toBe(
      "https://x.com/p?keep=1",
    );
  });
  it("trims a trailing slash but keeps the bare root slash", () => {
    expect(normUrl("https://x.com/a/")).toBe("https://x.com/a");
    expect(normUrl("https://x.com/")).toBe("https://x.com/");
    expect(normUrl("https://x.com")).toBe("https://x.com/");
  });
  it("returns unparseable input unchanged", () => {
    expect(normUrl("not a url")).toBe("not a url");
  });
});

describe("unwrapArchiveUrl", () => {
  it("recovers the original from an id_ wayback wrapper", () => {
    expect(
      unwrapArchiveUrl("https://web.archive.org/web/20240101000000id_/https://reddit.com/r/cdn/best"),
    ).toBe("https://reddit.com/r/cdn/best");
  });
  it("leaves a non-archive URL unchanged", () => {
    expect(unwrapArchiveUrl("https://g2.com/x")).toBe("https://g2.com/x");
  });
});

describe("citationHost", () => {
  it("returns the www-stripped host of a plain URL", () => {
    expect(citationHost("https://www.G2.com/products/foo")).toBe("g2.com");
    expect(citationHost("https://medium.com/@a/b")).toBe("medium.com");
  });
  it("unwraps a web.archive.org snapshot to the original host", () => {
    expect(
      citationHost("https://web.archive.org/web/20240101000000id_/https://reddit.com/r/cdn"),
    ).toBe("reddit.com");
  });
  it("uses the title as host for an unresolved Gemini vertexaisearch redirect", () => {
    const url =
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQG2qytYCD4d0ceWSF";
    expect(citationHost(url, "bejamas.com")).toBe("bejamas.com");
    expect(citationHost(url, "hostafrica.co.za")).toBe("hostafrica.co.za");
  });
  it("falls back to the redirect host when the title is not a bare domain", () => {
    const url = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz";
    expect(citationHost(url, "Some Article Headline")).toBe("vertexaisearch.cloud.google.com");
    expect(citationHost(url, null)).toBe("vertexaisearch.cloud.google.com");
  });
  it("does NOT treat a real (non-redirect) URL's title as the host", () => {
    // title only overrides for vertexaisearch redirects
    expect(citationHost("https://realsite.com/x", "other.com")).toBe("realsite.com");
  });
  it("returns empty string for an unparseable URL", () => {
    expect(citationHost("garbage", "g2.com")).toBe("");
  });
});
