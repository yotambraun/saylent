# Kestrel Uptime, a real sample run

`run.json` is a complete, unedited run of the engine (`packages/engine`) against
**Kestrel Uptime**, a fictional uptime-monitoring product we built and hosted at
`saylent-kestrel.vercel.app` so a real sample could ship without auditing a
company we do not own. Every number, gate, citation, page and generated fix in
it is exactly what the engine produced.

Re-render it offline, with no network, no LLM call and no database:

```bash
npx saylent report examples/kestrel/run.json
```

Kestrel Uptime itself is real in the file. Every other company, product and host
that the engines mentioned has been pseudonymized, so no third party's AI
opinion is republished under its own name.

- **Run date:** 2026-09-10
- **Profile:** `smoke`, 6 of 23 frozen questions x 4 engines (chatgpt, claude,
  gemini, perplexity) = 24 answers asked, 23 answered, cross-family judge
  (Anthropic + OpenAI); two rivals named on the command line so the head-to-head
  questions are real
- **Cost:** $1.11

From a checkout of this repo, without installing the CLI:

```bash
npx tsx --tsconfig scripts/tsconfig.json packages/cli/src/index.ts report examples/kestrel/run.json
```

Both write `report.html` and `report.md` next to the bundle.

<details>
<summary>What exactly was replaced, and what was kept</summary>

The rule is that this file must not republish any third party's identity,
whether or not an AI opinion is attached to it. It is applied by
`scripts/pseudonymize-run.ts` across the whole bundle: raw answer text, every
sampled draw, citations, cited pages, contact details, share of voice, and the
generated fix artifacts. The name to pseudonym map it reads is private and is
not published.

1. **Every third-party host is replaced** with a fictional host on `.example`:
   citation URLs, cited-page URLs, `citation.host`, contact emails and contact
   forms, and any URL inside answer text or a generated fix. Not a curated
   subset: the script enumerates every host in the bundle, pseudonymizes
   anything not on the two short exception lists below, and then fails the run
   if one survives.
2. **Product and company names in prose are replaced from the private map**,
   wherever they appear, including page titles, which are rewritten to the
   fictional site's name so a title agrees with its URL. This is a curated map,
   not a detector: generic technology vocabulary that nobody is being compared
   on (Playwright, Ubuntu, Kubernetes, Docker, HIPAA and the like) is not in the
   map and stays as written.
3. **Personal identities are removed.** A `/@name`, `/u/name`, `/user/name` or
   `/users/name` path becomes `/author-profile`, a per-user subdomain
   (`name.medium.com`) is folded onto the bare platform, and a
   "... | by *person* | ..." byline is stripped from page titles.

The only hosts kept real:

- **Public user-generated-content platforms, as bare hosts:** `wikipedia.org`,
  `reddit.com`, `news.ycombinator.com`, `stackoverflow.com`, `github.com`,
  `youtube.com`, `medium.com`. A link to one of these is a link to a page anyone
  can publish, not a company being recommended. The personal-identity rules
  above still apply to them, and the private map may override any of them in the
  stricter direction. In this run, GitHub citations were pseudonymized anyway,
  because GitHub URLs and issue titles carry real org and repo identity. The
  hosts that actually remain in this file are `en.wikipedia.org`, `reddit.com`,
  `news.ycombinator.com` and `medium.com`.
- **Infrastructure vendors a fix tells you to open in your own dashboard:**
  CDNs, web servers and hosting platforms (Cloudflare, Fastly, Akamai, AWS
  CloudFront, Nginx, Apache, IIS, Vercel, Caddy, Netlify) keep their real names
  and documentation hosts, because a fictional "check your CDN's bot toggle"
  table would make the fix wrong. They are never the subject of a claim; every
  rival, cloud and messaging tool is still pseudonymized.
- **Two hosts that are nobody's website:** `schema.org` (a JSON-LD `"@context"`
  must literally be the vocabulary URL, or the generated fix artifact would be
  wrong) and `yourdomain.com` (a "put your own domain here" placeholder inside a
  generated fix, which has to keep reading as one).
- **The AI answer engines themselves:** ChatGPT, Claude, Gemini, Perplexity and
  their crawler user-agents. Which engines were audited is the subject of the
  report, and the robots.txt fix artifact's instructions would be wrong without
  their real user-agent names.

No rival, no listicle site, no review blog, no docs host and no incidental
vendor is kept, so nothing in this file can be read as this project's opinion
about a company we do not own.

</details>

<details>
<summary>Provenance</summary>

- `run.json` is the pseudonymized bundle (`RunBundleV1`, see
  `packages/engine/src/bundle.ts`).
- The real name and host to fictional name and host mapping used to produce this
  file is kept in a private, unpublished file, because it names real companies.
  The *policy* that decides what gets replaced lives in the public script,
  `scripts/pseudonymize-run.ts`, so it can be read and checked.
- The same run also seeds `fixtures/run.json`, the $0 UI-development fixture, via
  `scripts/bundle-to-fixture.ts`. One real run, so the public sample and the
  fixture the test suite runs against never drift apart.

</details>
