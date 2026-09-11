# Planted gaps in the Kestrel brand site

The Kestrel site is deliberately imperfect. Every gap below is one the audit engine is
good at finding, so the public sample report has real findings, and a "before vs.
after" tracking demo can show real movement: run `saylent audit` against this site as
the baseline, apply the fixes in the table below in one commit, then re-run
`saylent verify --baseline run.json` and diff the two reports.

Do not fix these before the baseline run - the whole point of the demo is a report with
real findings, followed by a real, reproducible improvement.

| # | Planted gap | Where | What the engine should say | The fix we apply for the tracking demo |
|---|---|---|---|---|
| 1 | No JSON-LD anywhere | every page | no structured data: the crawler records an empty `ldTypes` for all seven pages | Add `Organization` + `WebSite` to the home page, `Product` with an `Offer` per tier to the pricing page, and `FAQPage` over the five questions already written on the pricing page. Mark up nothing that is not already visible copy. |
| 2 | No `llms.txt` | site root | no machine readable summary for answer engines | Add `/llms.txt` listing the seven pages with one line each, plus the one sentence description of what Kestrel is. |
| 3 | `ClaudeBot` and `PerplexityBot` get `Disallow: /` | `src/robots.txt` | the three class taxonomy has one of each to talk about: `ClaudeBot` is a TRAINING bot, so blocking it is a legitimate choice and scores a warning. `PerplexityBot` is a SEARCH bot, so blocking it removes citation eligibility and scores a fail. Googlebot and Bingbot stay allowed, which is what makes the contrast readable. | Delete both `Disallow: /` groups so every registry bot is allowed, and keep the explicit `Googlebot` and `Bingbot` groups. |
| 4 | The comparison page has no table and no numbers | `src/compare/index.html` | a comparison page an assistant cannot extract a comparison from: prose only, no checkable claims, categories instead of specifics | Add a comparison table with concrete Kestrel numbers (check interval, regions, escalation, status page domain, price) against generic categories only: "hosted incumbents", "self hosted stacks", "a cron job". No real company is named on that page, before or after. |
| 5 | Thin entity clarity on About | `src/about/index.html` | the engine cannot tell what the company legally is: no founding year, no legal name, no headquarters, no team size, no profile links | Add one short paragraph naming the founding year, the legal name and the (fictional) city, and mirror those exact facts in the `Organization` JSON-LD from fix 1. |

## Deliberately NOT planted

These are correct on purpose, so the report has passes as well as failures and so the
gaps above stand out as the real findings: a unique `<title>` and meta description per
page, a `sitemap.xml` listing all seven pages with `lastmod`, a `Sitemap:` line in
`robots.txt`, semantic HTML with one `<h1>` per page, real depth (400+ words on the
home page, 300+ on docs, pricing and compare), no client side rendering, and no
external requests at all.

## Running the audit against this site

**Localhost is blocked by design.** `packages/engine/src/util.ts` `safeFetch()` refuses
loopback and private hosts twice over: `isBlockedHost()` rejects the literal
`localhost` and `127.0.0.0/8`, and the post DNS check rejects any hostname that
resolves into a private range. There is no localhost exemption and this guard must not
be weakened. A run against `node serve.mjs` therefore needs an explicit opt-in on the
caller's side - the CLI's `saylent audit --allow-private <domain>` flag, which allows
the audited host (and its www/apex sibling) to resolve to a private/internal address for
that one run. This example doesn't add or change that flag; it just needs it to be
audited locally at all.

**Robots.txt is read from the host root.** `crawlSite()` reads `robots.txt` from the
HOST root, which is where the standard says it lives, and `runDomainChecks()` in
`packages/engine/src/domainChecks.ts` does the same for its own `https://<host>/robots.txt`
fetch and the live per-user-agent probe against `https://<host>/`. This example is
served from a host root (`saylent-kestrel.vercel.app`), so gap 3 above is visible to
the audit as expected. `crawlSite()` also accepts a site root with a path and keeps the
crawl inside that path if you deploy this example somewhere else under a subpath - just
know that in that case `robots.txt` and the domain checks above still resolve against
the deployment's host root, not the subpath.
