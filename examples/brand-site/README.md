# examples/brand-site: Kestrel Uptime

A small static website for a **fictional** company, hosted for real so the audit engine
can crawl a subject we own. It is the source of the public sample report (the one
embedded on the landing page and linked from the docs), the test fixtures, the judge's
golden set, and the "planted gaps" tracking demo (see `PLANTED-GAPS.md` in this
directory).

Kestrel Uptime sells uptime monitoring and status pages to small engineering teams. The
category was chosen because answer engines respond to "best uptime monitoring tool"
questions richly and name real rivals, which is exactly what the pseudonymization step
after the run is for.

## Rules for this directory

- **Nothing real.** No real company, product, person, logo or trademark appears
  anywhere on the site. Emails are on `kestrel.example`, which is a reserved TLD and can
  never be registered. Every number is invented.
- **The site says so.** Every page footer states that Kestrel is fictional and that the
  site is a test subject.
- **The gaps are the point.** `PLANTED-GAPS.md` lists what is deliberately missing and
  the exact fix the tracking demo applies. Do not fix them ahead of the baseline run.
- Plain HTML and one stylesheet. No framework, no build step beyond string
  substitution, no external requests (no CDN fonts, no analytics, no images).

## Layout

```
src/                the site, with {{SITE_ROOT}} wherever an absolute URL is needed
  index.html        home
  pricing/          three tiers and the questions we get asked
  docs/             setup, check types, alerting, status pages, API
  compare/          "Kestrel and the alternatives" (no real company named)
  about/            fictional founders, fictional city
  changelog/        five dated releases
  contact/          four addresses on kestrel.example
  styles.css        the whole design system
  robots.txt        planted gap 3 lives here
  sitemap.xml       all seven pages
build.mjs           src/ to dist/, substituting the site root
serve.mjs           builds, then serves dist/ on localhost
dist/               generated, git ignored
```

## Build

```
node examples/brand-site/build.mjs                       # defaults to https://saylent-kestrel.vercel.app
node examples/brand-site/build.mjs --root http://localhost:8787
```

`--root` is an absolute URL without a trailing slash. Every `{{SITE_ROOT}}` in a text
file is replaced with it, so the same source works at a bare host and under a
path-prefixed one. Output goes to `dist/`, which is wiped on each build.

## Serve locally

```
node examples/brand-site/serve.mjs --port 8787
```

Builds for `http://localhost:8787` first, then serves `dist/` with the Node http module
and no dependencies. Directory paths without a trailing slash get a 301, like a real
host. Read `PLANTED-GAPS.md` before pointing the engine at it: `safeFetch()` blocks
loopback hosts on purpose, so a local run needs an explicit opt in from the caller.

## Deploy

The public sample is deployed to Vercel at `https://saylent-kestrel.vercel.app` (a host
root, not a path-prefixed project site) specifically so it owns `robots.txt` at the host
root - the planted gap in `robots.txt` (see `PLANTED-GAPS.md`) needs to be real, and a
path-prefixed deploy (a GitHub Pages project site, for instance) can't own that file at
the host root. Copy `dist/` to whatever serves the site; rebuild with `--root` set to
wherever you're actually deploying if it isn't the default above.
