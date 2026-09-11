// Corpus enrichment extractors: page_date (own-date signal),
// contact (outlet outreach channel), and depth measurement. Pure, no network.
import { describe, expect, it } from "vitest";
import { extractContact, extractPageDate, measureDepth } from "./corpus";

describe("extractPageDate", () => {
  it("reads article:published_time meta (either attribute order) → ISO", () => {
    const a = `<meta property="article:published_time" content="2024-03-15T10:00:00Z">`;
    expect(extractPageDate(a)).toBe("2024-03-15T10:00:00.000Z");
    const b = `<meta content="2024-03-15" property="article:published_time">`;
    expect(extractPageDate(b)).toBe("2024-03-15T00:00:00.000Z");
  });

  it("prefers published_time over a <time> element and JSON-LD (spec priority order)", () => {
    const html =
      `<meta property="article:published_time" content="2024-01-01">` +
      `<time datetime="2020-05-05">old</time>` +
      `<script type="application/ld+json">{"datePublished":"2019-09-09"}</script>`;
    expect(extractPageDate(html)).toBe("2024-01-01T00:00:00.000Z");
  });

  it("falls back to <time datetime> when no meta date is present", () => {
    expect(extractPageDate(`<time datetime="2023-07-04T00:00:00Z">Jul 4</time>`)).toBe(
      "2023-07-04T00:00:00.000Z",
    );
  });

  it("reads JSON-LD datePublished (nested in @graph) when meta/time are absent", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@graph": [{ "@type": "Article", datePublished: "2022-02-02T09:00:00Z" }],
    })}</script>`;
    expect(extractPageDate(html)).toBe("2022-02-02T09:00:00.000Z");
  });

  it("uses the Last-Modified header only as a last resort", () => {
    expect(extractPageDate("<p>no dates here</p>", "Wed, 21 Oct 2023 07:28:00 GMT")).toBe(
      "2023-10-21T07:28:00.000Z",
    );
  });

  it("returns null for junk / out-of-window dates (null beats guessing)", () => {
    expect(extractPageDate("<p>no date at all</p>")).toBeNull();
    expect(extractPageDate(`<time datetime="not-a-date">x</time>`)).toBeNull();
    expect(extractPageDate(`<meta property="article:published_time" content="1200-01-01">`)).toBeNull();
  });
});

describe("extractContact", () => {
  const page = "https://blog.example.com/best-tools";

  it("captures a mailto address", () => {
    const c = extractContact(`<a href="mailto:editor@example.com?subject=hi">Email us</a>`, page);
    expect(c).toEqual({ mailto: "editor@example.com" });
  });

  it("captures a write-for-us / contribute link resolved to an absolute URL", () => {
    const c = extractContact(`<a href="/write-for-us">Contribute</a>`, page);
    expect(c).toEqual({ form_url: "https://blog.example.com/write-for-us" });
  });

  it("derives the G2 vendor-claim URL from the product slug", () => {
    const c = extractContact("<a href='/foo'>x</a>", "https://www.g2.com/products/mailforge/reviews");
    expect(c).toEqual({ claim_url: "https://www.g2.com/products/mailforge/take_ownership" });
  });

  it("returns the Capterra / TrustRadius vendor entry point on those platforms", () => {
    expect(extractContact("<html></html>", "https://www.capterra.com/p/12345/Mailforge/")).toEqual({
      claim_url: "https://www.capterra.com/vendors/sign-up",
    });
    expect(extractContact("<html></html>", "https://www.trustradius.com/products/mailforge/reviews")).toEqual({
      claim_url: "https://www.trustradius.com/vendor",
    });
  });

  it("combines multiple signals and returns null when there are none", () => {
    const c = extractContact(
      `<a href="mailto:hi@g2.com">mail</a><a href="/contact">Contact</a>`,
      "https://www.g2.com/products/mailforge/reviews",
    );
    expect(c).toEqual({
      mailto: "hi@g2.com",
      form_url: "https://www.g2.com/contact",
      claim_url: "https://www.g2.com/products/mailforge/take_ownership",
    });
    expect(extractContact("<p>nothing actionable here</p>", page)).toBeNull();
  });
});

describe("measureDepth", () => {
  it("counts words from the stripped text and content headings (h2/h3) from the raw HTML", () => {
    const text = Array.from({ length: 150 }, (_, i) => `w${i}`).join(" ");
    const html = `<h1>Title</h1><h2>One</h2><h2>Two</h2><h3>Two-a</h3><p>${text}</p>`;
    expect(measureDepth(html, text)).toEqual({ word_count: 150, section_count: 3 });
  });

  it("is zero-words for empty text", () => {
    expect(measureDepth("<div></div>", "")).toEqual({ word_count: 0, section_count: 0 });
  });
});
