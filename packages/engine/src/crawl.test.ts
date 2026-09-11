// Crawler v2 (TODO "Crawler v2") — sitemap discovery, non-English locale-prefix
// skip, and honest thin/SPA classification. Fetch is mocked via the injectable
// fetcher (same pattern as resolve-redirects.test.ts); these tests NEVER hit the
// network.
import { describe, expect, it, vi } from "vitest";
import {
  classifyBlocked,
  classifySiteThin,
  classifyThin,
  CRAWL_BLOCKED_MARKER,
  CRAWL_THIN_MARKER,
  crawlSite,
  discoverSitemapUrls,
  isNonEnglishLocalePath,
  parseDate,
  parseSitemapLocs,
  parseSiteRoot,
  wwwApexSibling,
} from "./crawl";
import type { SafeFetchResult } from "./util";

/** build a mock safeFetch from a {url → SafeFetchResult} map; unknown → 404 */
function mockFetcher(map: Record<string, Partial<SafeFetchResult>>) {
  return vi.fn(async (url: string) => {
    const hit = map[url];
    if (hit) return { status: 200, finalUrl: url, text: "", ...hit } as SafeFetchResult;
    return { status: 404, finalUrl: url, text: "" } as SafeFetchResult;
  }) as unknown as typeof import("./util").safeFetch;
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const htmlPage = (body: string) => `<html><head><title>t</title></head><body>${body}</body></html>`;

describe("parseSitemapLocs", () => {
  it("parses a plain urlset sitemap", () => {
    const xml =
      "<urlset><url><loc>https://x.com/a</loc></url><url><loc> https://x.com/b </loc></url></urlset>";
    const { locs, isIndex } = parseSitemapLocs(xml);
    expect(isIndex).toBe(false);
    expect(locs).toEqual(["https://x.com/a", "https://x.com/b"]);
  });

  it("flags a sitemap INDEX and returns its child-sitemap locs", () => {
    const xml =
      "<sitemapindex><sitemap><loc>https://x.com/sm1.xml</loc></sitemap><sitemap><loc>https://x.com/sm2.xml</loc></sitemap></sitemapindex>";
    const { locs, isIndex } = parseSitemapLocs(xml);
    expect(isIndex).toBe(true);
    expect(locs).toEqual(["https://x.com/sm1.xml", "https://x.com/sm2.xml"]);
  });

  it("decodes XML entities in <loc>", () => {
    const { locs } = parseSitemapLocs("<urlset><url><loc>https://x.com/a?b=1&amp;c=2</loc></url></urlset>");
    expect(locs).toEqual(["https://x.com/a?b=1&c=2"]);
  });

  it("caps an oversized sitemap at 500 locs", () => {
    const urls = Array.from({ length: 600 }, (_, i) => `<url><loc>https://x.com/p${i}</loc></url>`).join("");
    const { locs } = parseSitemapLocs(`<urlset>${urls}</urlset>`);
    expect(locs).toHaveLength(500);
  });

  it("pairs each <loc> with its parsed <lastmod> (null when absent/bad)", () => {
    const xml =
      "<urlset>" +
      "<url><loc>https://x.com/a</loc><lastmod>2024-05-01</lastmod></url>" +
      "<url><loc>https://x.com/b</loc></url>" +
      "<url><loc>https://x.com/c</loc><lastmod>garbage</lastmod></url>" +
      "</urlset>";
    const { locs, lastmods } = parseSitemapLocs(xml);
    expect(locs).toEqual(["https://x.com/a", "https://x.com/b", "https://x.com/c"]);
    expect(lastmods).toEqual(["2024-05-01T00:00:00.000Z", null, null]);
  });
});

describe("parseDate", () => {
  it("normalizes valid dates to ISO and rejects junk / out-of-window values", () => {
    expect(parseDate("2024-05-01")).toBe("2024-05-01T00:00:00.000Z");
    expect(parseDate("Wed, 21 Oct 2023 07:28:00 GMT")).toBe("2023-10-21T07:28:00.000Z");
    expect(parseDate("not a date")).toBeNull();
    expect(parseDate("1500-01-01")).toBeNull(); // before the sanity window
    expect(parseDate("")).toBeNull();
  });
});

describe("isNonEnglishLocalePath", () => {
  it("skips non-English locale prefixes (incl. xx-yy)", () => {
    for (const p of ["/es/precios", "/de/preise", "/fr/tarifs", "/pt/precos", "/pt-br/precos", "/ja/x", "/zh/x", "/ko/x"]) {
      expect(isNonEnglishLocalePath(p)).toBe(true);
    }
  });

  it("does NOT skip English or non-locale two-letter segments", () => {
    for (const p of ["/en/pricing", "/en-us/pricing", "/go/link", "/ai/agents", "/vs/competitor", "/pricing", "/product", "/", ""]) {
      expect(isNonEnglishLocalePath(p)).toBe(false);
    }
  });
});

describe("classifyThin", () => {
  it("flags an empty-root JS shell with little text", () => {
    const shell = htmlPage(`<div id="root"></div><script>${"x".repeat(4000)}</script>`);
    expect(classifyThin(shell, "")).toBe(true);
  });

  it("flags a script-heavy page whose static text is thin", () => {
    const heavy = htmlPage(`<p>Loading</p><script>${"a".repeat(3000)}</script>`);
    expect(classifyThin(heavy, "Loading")).toBe(true);
  });

  it("does NOT flag a normal content page (over the word threshold)", () => {
    const article = htmlPage(`<article>${words(200)}</article>`);
    expect(classifyThin(article, words(200))).toBe(false);
  });

  it("does NOT flag a genuinely small STATIC page (no shell signals)", () => {
    const about = htmlPage("<h1>About</h1><p>We are a small team building software.</p>");
    expect(classifyThin(about, "About We are a small team building software.")).toBe(false);
  });
});

// Blocked-crawler detection, thin-site rollup,
// www/apex normalization.
describe("classifyBlocked", () => {
  it("flags a 403 with a Cloudflare challenge page as blocked, names the challenge", () => {
    const r = classifyBlocked(403, "<html>Attention Required! | Cloudflare</html>");
    expect(r.blocked).toBe(true);
    expect(r.reason).toContain("WAF challenge");
  });

  it("flags a bare 403/429/503 with no challenge markup, worded as a refusal", () => {
    for (const status of [403, 429, 503]) {
      const r = classifyBlocked(status, "<html><body>Forbidden</body></html>");
      expect(r.blocked).toBe(true);
      expect(r.reason).toContain(String(status));
      expect(r.reason).toContain("refused");
    }
  });

  it("does NOT flag an ordinary 404 or a 200", () => {
    expect(classifyBlocked(404, "<html>Not Found</html>").blocked).toBe(false);
    expect(classifyBlocked(200, "<html>ok</html>").blocked).toBe(false);
  });
});

describe("classifySiteThin", () => {
  it("true when the home page (first in the array) is thin", () => {
    expect(classifySiteThin([{ thin: true }, {}, {}])).toBe(true);
  });

  it("true when at least 60% of pages are thin", () => {
    expect(classifySiteThin([{}, { thin: true }, { thin: true }, { thin: true }])).toBe(true);
  });

  it("false when few pages are thin and the home page is not", () => {
    expect(classifySiteThin([{}, {}, {}, { thin: true }])).toBe(false);
  });

  it("false for an empty crawl", () => {
    expect(classifySiteThin([])).toBe(false);
  });
});

describe("wwwApexSibling", () => {
  it("strips www. from a www host", () => {
    expect(wwwApexSibling("www.acme.com")).toBe("acme.com");
  });

  it("adds www. to a bare two-label apex host", () => {
    expect(wwwApexSibling("acme.com")).toBe("www.acme.com");
  });

  it("returns null for a subdomain (not apex/www)", () => {
    expect(wwwApexSibling("docs.acme.com")).toBeNull();
  });

  it("returns null for a bare single-label host", () => {
    expect(wwwApexSibling("localhost")).toBeNull();
  });
});

describe("crawlSite — F3 blocked/thin notices via the existing onProgress channel", () => {
  it("relays a blocked-home notice tagged with CRAWL_BLOCKED_MARKER, once", async () => {
    const fetcher = mockFetcher({
      "https://blocked.com": {
        status: 403,
        text: "<html>Attention Required! | Cloudflare</html>",
      },
    });
    const seen: string[] = [];
    await crawlSite("blocked.com", 25, async (path) => {
      seen.push(path);
    }, { fetcher });
    const blockedLines = seen.filter((s) => s.startsWith(CRAWL_BLOCKED_MARKER));
    expect(blockedLines).toHaveLength(1);
    expect(blockedLines[0]).toContain("403");
  });

  it("does NOT relay a blocked notice for a normal 200 home page", async () => {
    const fetcher = mockFetcher({
      "https://ok.com": { finalUrl: "https://ok.com", text: htmlPage(`<p>${words(150)}</p>`) },
    });
    const seen: string[] = [];
    await crawlSite("ok.com", 25, async (path) => {
      seen.push(path);
    }, { fetcher });
    expect(seen.some((s) => s.startsWith(CRAWL_BLOCKED_MARKER))).toBe(false);
  });

  it("relays a thin-site notice when the home page is a JS shell", async () => {
    const shell = htmlPage(`<div id="app"></div><script>${"x".repeat(4000)}</script>`);
    const fetcher = mockFetcher({
      "https://spa.com": { finalUrl: "https://spa.com", text: shell },
    });
    const seen: string[] = [];
    await crawlSite("spa.com", 25, async (path) => {
      seen.push(path);
    }, { fetcher });
    expect(seen.some((s) => s.startsWith(CRAWL_THIN_MARKER))).toBe(true);
  });

  it("treats www./apex as the same root: a link to the sibling host is still crawled as internal", async () => {
    const home = htmlPage(`<p>${words(150)}</p><a href="https://www.acme.com/pricing">pricing</a>`);
    const fetcher = mockFetcher({
      "https://acme.com": { finalUrl: "https://acme.com", text: home },
      "https://www.acme.com/pricing": {
        finalUrl: "https://www.acme.com/pricing",
        text: htmlPage(`<article>${words(150)}</article>`),
      },
    });
    const pages = await crawlSite("acme.com", 25, undefined, { fetcher });
    const paths = pages.map((p) => p.url);
    expect(paths).toContain("https://www.acme.com/pricing");
  });

  it("--max-pages (the existing maxPages parameter): caps the crawled page count", async () => {
    const home = htmlPage(
      `<p>${words(150)}</p>` +
        Array.from({ length: 5 }, (_, i) => `<a href="/page${i}">p${i}</a>`).join(""),
    );
    const map: Record<string, { finalUrl: string; text: string }> = {
      "https://many.com": { finalUrl: "https://many.com", text: home },
    };
    for (let i = 0; i < 5; i++) {
      map[`https://many.com/page${i}`] = {
        finalUrl: `https://many.com/page${i}`,
        text: htmlPage(`<article>${words(150)}</article>`),
      };
    }
    const fetcher = mockFetcher(map);
    const pages = await crawlSite("many.com", 3, undefined, { fetcher });
    expect(pages.length).toBeLessThanOrEqual(3);
  });
});

describe("discoverSitemapUrls", () => {
  const hosts = new Set(["example.com"]);

  it("reads robots Sitemap directive and follows an index one level deep", async () => {
    const fetcher = mockFetcher({
      "https://example.com/robots.txt": { text: "User-agent: *\nSitemap: https://example.com/smindex.xml\n" },
      "https://example.com/smindex.xml": {
        text: "<sitemapindex><sitemap><loc>https://example.com/sm1.xml</loc></sitemap></sitemapindex>",
      },
      "https://example.com/sm1.xml": {
        text: "<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://other.com/z</loc></url></urlset>",
      },
    });
    const out = await discoverSitemapUrls("https://example.com", hosts, fetcher);
    expect(out).toContain("https://example.com/a");
    expect(out).not.toContain("https://other.com/z"); // cross-host loc dropped
  });

  it("returns [] when nothing is discoverable (all 404)", async () => {
    const out = await discoverSitemapUrls("https://example.com", hosts, mockFetcher({}));
    expect(out).toEqual([]);
  });

  it("fills the optional lastmod out-map with normUrl → ISO date", async () => {
    const fetcher = mockFetcher({
      "https://example.com/sitemap.xml": {
        text:
          "<urlset>" +
          "<url><loc>https://example.com/a</loc><lastmod>2024-06-01</lastmod></url>" +
          "<url><loc>https://example.com/b</loc></url>" +
          "</urlset>",
      },
    });
    const dates = new Map<string, string>();
    const out = await discoverSitemapUrls("https://example.com", hosts, fetcher, dates);
    expect(out).toContain("https://example.com/a");
    expect(dates.get("https://example.com/a")).toBe("2024-06-01T00:00:00.000Z");
    expect(dates.has("https://example.com/b")).toBe(false); // no lastmod → not recorded
  });
});

describe("crawlSite integration (mock fetcher)", () => {
  it("crawls sitemap-discovered pages, skips locale prefixes, keeps /go/, flags thin pages", async () => {
    const home = htmlPage(
      `<p>${words(200)}</p><a href="/go/partner">go</a><a href="/es/precios">es</a>`,
    );
    const fetcher = mockFetcher({
      "https://example.com": { finalUrl: "https://example.com", text: home },
      "https://example.com/robots.txt": { text: "Sitemap: https://example.com/sitemap.xml" },
      "https://example.com/sitemap.xml": {
        text:
          "<urlset>" +
          "<url><loc>https://example.com/features</loc></url>" +
          "<url><loc>https://example.com/de/funktionen</loc></url>" + // locale → skipped
          "</urlset>",
      },
      "https://example.com/features": {
        finalUrl: "https://example.com/features",
        text: htmlPage(`<article>${words(200)}</article>`),
      },
      "https://example.com/go/partner": {
        finalUrl: "https://example.com/go/partner",
        text: htmlPage(`<article>${words(200)}</article>`),
      },
      // a cited-style SPA shell reached from the homepage link would be thin
      "https://example.com/es/precios": {
        finalUrl: "https://example.com/es/precios",
        text: htmlPage(`<div id="root"></div><script>${"x".repeat(4000)}</script>`),
      },
    });

    const pages = await crawlSite("example.com", 25, undefined, { fetcher });
    const paths = pages.map((p) => new URL(p.url).pathname);

    expect(paths).toContain("/features"); // discovered via sitemap
    expect(paths).toContain("/go/partner"); // /go/ is NOT a locale — kept
    expect(paths).not.toContain("/es/precios"); // non-English locale skipped
    expect(paths).not.toContain("/de/funktionen"); // sitemap locale skipped
  });

  it("threads the sitemap <lastmod> onto an own-site page as `date`", async () => {
    const home = htmlPage(`<p>${words(200)}</p>`);
    const fetcher = mockFetcher({
      "https://example.com": { finalUrl: "https://example.com", text: home },
      "https://example.com/robots.txt": { text: "Sitemap: https://example.com/sitemap.xml" },
      "https://example.com/sitemap.xml": {
        text:
          "<urlset><url><loc>https://example.com/features</loc><lastmod>2024-08-15</lastmod></url></urlset>",
      },
      "https://example.com/features": {
        finalUrl: "https://example.com/features",
        text: htmlPage(`<article>${words(200)}</article>`),
      },
    });
    const pages = await crawlSite("example.com", 25, undefined, { fetcher });
    const features = pages.find((p) => new URL(p.url).pathname === "/features");
    expect(features?.date).toBe("2024-08-15T00:00:00.000Z");
    // homepage was not sitemap-discovered → no date attached
    expect(pages.find((p) => new URL(p.url).pathname === "/")?.date).toBeUndefined();
  });

  it("marks a homepage that is a JS shell as thin", async () => {
    const shell = htmlPage(`<div id="app"></div><script>${"x".repeat(4000)}</script>`);
    const fetcher = mockFetcher({
      "https://spa.com": { finalUrl: "https://spa.com", text: shell },
    });
    const pages = await crawlSite("spa.com", 25, undefined, { fetcher });
    expect(pages[0]?.thin).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SUBPATH HOSTING — the Kestrel example site is
// served from a GitHub Pages subpath, so the crawl must accept `host/path/` as
// the site root, stay inside that path, and still read robots.txt from the HOST
// root. Bare-domain behaviour must not move a byte.
// ---------------------------------------------------------------------------
describe("parseSiteRoot", () => {
  it("leaves a bare domain exactly where it was", () => {
    for (const input of ["example.com", "https://example.com", "https://example.com/"]) {
      expect(parseSiteRoot(input)).toEqual({
        origin: "https://example.com",
        base: "https://example.com",
        prefix: "/",
      });
    }
  });

  it("keeps a subpath as the site root and derives the host root for robots.txt", () => {
    for (const input of ["user.github.io/saylent-kestrel", "https://user.github.io/saylent-kestrel/"]) {
      expect(parseSiteRoot(input)).toEqual({
        origin: "https://user.github.io",
        base: "https://user.github.io/saylent-kestrel",
        prefix: "/saylent-kestrel/",
      });
    }
  });

  it("honours an explicit http scheme and a port (the local rig)", () => {
    expect(parseSiteRoot("http://localhost:8787/")).toEqual({
      origin: "http://localhost:8787",
      base: "http://localhost:8787",
      prefix: "/",
    });
  });

  it("falls back to the bare-host derivation when the input will not parse", () => {
    expect(parseSiteRoot("ex ample.com/x")).toEqual({
      origin: "https://ex ample.com",
      base: "https://ex ample.com",
      prefix: "/",
    });
  });
});

describe("crawlSite on a subpath site root", () => {
  const HOME = "https://user.github.io/saylent-kestrel/";
  const home = htmlPage(
    `<p>${words(200)}</p>` +
      `<a href="/saylent-kestrel/pricing/">Pricing</a>` +
      `<a href="/saylent-kestrel/es/precios">Precios</a>` +
      `<a href="/other-project/page">Someone else's project</a>` +
      `<a href="/">The user site root</a>`,
  );

  const build = () =>
    mockFetcher({
      [HOME]: { finalUrl: HOME, text: home },
      // robots.txt is read from the HOST root, which is where the standard puts it
      "https://user.github.io/robots.txt": {
        text:
          "Sitemap: https://user.github.io/saylent-kestrel/sitemap.xml\n" +
          "Sitemap: https://user.github.io/other-project/sitemap.xml\n",
      },
      "https://user.github.io/saylent-kestrel/sitemap.xml": {
        text:
          "<urlset>" +
          "<url><loc>https://user.github.io/saylent-kestrel/docs/</loc><lastmod>2026-08-19</lastmod></url>" +
          "<url><loc>https://user.github.io/other-project/leak</loc></url>" +
          "</urlset>",
      },
      "https://user.github.io/saylent-kestrel/pricing/": {
        finalUrl: "https://user.github.io/saylent-kestrel/pricing/",
        text: htmlPage(`<article>${words(200)}</article>`),
      },
      "https://user.github.io/saylent-kestrel/docs/": {
        finalUrl: "https://user.github.io/saylent-kestrel/docs/",
        text: htmlPage(`<article>${words(200)}</article>`),
      },
      "https://user.github.io/other-project/page": {
        finalUrl: "https://user.github.io/other-project/page",
        text: htmlPage(`<article>${words(200)}</article>`),
      },
      "https://user.github.io/": { finalUrl: "https://user.github.io/", text: htmlPage("<p>user site</p>") },
    });

  it("crawls the subpath, never leaves it, and reads robots.txt from the host root", async () => {
    const fetcher = build();
    const pages = await crawlSite("user.github.io/saylent-kestrel", 25, undefined, { fetcher });
    const paths = pages.map((p) => new URL(p.url).pathname);

    expect(paths).toEqual([
      "/saylent-kestrel/",
      "/saylent-kestrel/pricing/",
      "/saylent-kestrel/docs/",
    ]);
    // the sitemap <lastmod> still lands on the discovered page
    expect(pages[2]?.date).toBe("2026-08-19T00:00:00.000Z");

    const asked = (fetcher as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (c) => c[0] as string,
    );
    expect(asked).toContain("https://user.github.io/robots.txt");
    expect(asked).toContain(HOME);
    // never the host root page, another project's pages, or another project's sitemap
    expect(asked).not.toContain("https://user.github.io/");
    expect(asked).not.toContain("https://user.github.io/other-project/page");
    expect(asked).not.toContain("https://user.github.io/other-project/sitemap.xml");
    // the locale skip is judged RELATIVE to the site root
    expect(paths).not.toContain("/saylent-kestrel/es/precios");
  });
});

describe("crawlSite on a bare domain (subpath change must not move a byte)", () => {
  it("requests exactly the same URLs it always did", async () => {
    const fetcher = mockFetcher({
      "https://example.com": {
        finalUrl: "https://example.com",
        text: htmlPage(`<p>${words(200)}</p><a href="/pricing">Pricing</a>`),
      },
      "https://example.com/robots.txt": { text: "" },
      "https://example.com/pricing": {
        finalUrl: "https://example.com/pricing",
        text: htmlPage(`<article>${words(200)}</article>`),
      },
    });
    const pages = await crawlSite("example.com", 25, undefined, { fetcher });
    const asked = (fetcher as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (c) => c[0] as string,
    );
    expect(asked).toContain("https://example.com"); // homepage, no trailing slash
    expect(asked).toContain("https://example.com/robots.txt");
    expect(asked).toContain("https://example.com/sitemap.xml");
    expect(pages.map((p) => p.url)).toEqual(["https://example.com", "https://example.com/pricing"]);
  });
});
