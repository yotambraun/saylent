// The docs-site widget (website/components/instant-check.tsx), rendered to
// a string. The website is a static export with no test runner of its own and
// the repo root's vitest project does not collect website/**, so the widget's
// test lives here, next to the service it talks to — the two are one feature
// and must not drift apart.
//
// A pure render-to-string test (no jsdom): what it proves is the part that must
// never break silently — the command-only fallback when the service URL is not
// configured, and that a result payload renders as the same four rows the CLI
// prints. React resolves from the monorepo's root node_modules; see
// vitest.config.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CANNOT_KNOW,
  InstantCheck,
  InstantCheckResultView,
  type InstantCheckResult,
} from "../../../website/components/instant-check";

const RESULT: InstantCheckResult = {
  domain: "acme.com",
  result: "fail",
  robots: {
    status: "warn",
    readable: true,
    training: [{ agent: "GPTBot", status: "warn", detail: "blocked" }],
    search: [{ agent: "OAI-SearchBot", status: "pass", detail: "allowed" }],
    user: [{ agent: "ChatGPT-User", status: "pass", detail: "allowed" }],
    notes: ["Google-Extended present — a training token, not a crawler"],
  },
  probe: {
    status: "fail",
    agents: [
      { agent: "OAI-SearchBot", http: "200", status: "pass", detail: "HTTP 200" },
      { agent: "ClaudeBot", http: "403", status: "fail", detail: "HTTP 403" },
    ],
    notes: [],
  },
  jsonld: {
    status: "warn",
    checked: true,
    types: [
      { type: "Organization", present: true, status: "pass", detail: "present" },
      { type: "FAQPage", present: false, status: "warn", detail: "No FAQPage schema found." },
    ],
  },
  meta: { status: "pass", checked: true, noindex: false, nosnippet: false, findings: [] },
  notes: [],
  checked_at: "2026-09-09T00:00:00.000Z",
  cached: false,
  elapsed_ms: 5100,
  pages_crawled: 3,
};

describe("InstantCheck fallback", () => {
  it("renders the command and no input when no service URL is configured", () => {
    const html = renderToStaticMarkup(<InstantCheck serviceUrl={undefined} />);
    expect(html).toContain("npx saylent gate-check acme.com");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<form");
  });

  it("renders the input when a service URL is configured, with the honest caveat", () => {
    const html = renderToStaticMarkup(<InstantCheck serviceUrl="https://example.test/api/check" />);
    expect(html).toContain("<form");
    expect(html).toContain('placeholder="acme.com"');
    expect(html).toContain("maxLength=\"253\"");
    expect(html).toContain(CANNOT_KNOW.slice(0, 40));
    // The service URL is never rendered into the page; it is only fetched.
    expect(html).not.toContain("example.test");
  });
});

describe("InstantCheckResultView", () => {
  const html = renderToStaticMarkup(<InstantCheckResultView result={RESULT} />);

  it("shows all four rows the CLI prints", () => {
    for (const row of ["robots.txt", "live probe", "JSON-LD", "meta"]) {
      expect(html, row).toContain(row);
    }
  });

  it("shows the per-class robots verdict and the live probe status codes", () => {
    expect(html).toContain("GPTBot");
    expect(html).toContain("blocked");
    expect(html).toContain("OAI-SearchBot");
    expect(html).toContain("200");
    expect(html).toContain("403");
    expect(html).toContain("robots allows, the CDN does not");
  });

  it("shows schema presence, the meta directives and the run facts", () => {
    expect(html).toContain("Organization");
    expect(html).toContain("FAQPage");
    expect(html).toContain("missing");
    expect(html).toContain("noindex");
    expect(html).toContain("3 pages");
    expect(html).toContain("5.1s");
    expect(html).toContain("$0");
  });

  it("ends with the full-audit command for the domain that was checked", () => {
    expect(html).toContain("npx saylent audit acme.com");
  });
});

describe("InstantCheckResultView — empty crawl (the honesty guard)", () => {
  // A site the engine could not read at all: `checked: false` on both
  // page-level sections. The widget must say "not checked", never render an
  // empty type list or an "absent"/pass-looking meta line as if the site were
  // clean (see gate.ts's honesty-guard comment and packages/engine's
  // domainChecks.ts).
  const UNREACHABLE: InstantCheckResult = {
    ...RESULT,
    result: "warn",
    jsonld: { status: "warn", checked: false, types: [] },
    meta: { status: "warn", checked: false, noindex: false, nosnippet: false, findings: [] },
    notes: ["We could not read any page on acme.com — not even via the public Internet Archive."],
    pages_crawled: 0,
  };
  const html = renderToStaticMarkup(<InstantCheckResultView result={UNREACHABLE} />);

  it("says not checked instead of rendering an empty schema list", () => {
    expect(html).toContain("Not checked (site unreachable)");
    expect(html).not.toContain("missing</span>");
  });

  it("never shows noindex/nosnippet as absent when the site could not be read", () => {
    expect(html).not.toContain("absent");
  });

  it("surfaces the crawl-failure note", () => {
    expect(html).toContain("We could not read any page on acme.com");
  });
});
