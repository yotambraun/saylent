# instant-check

The free, keyless AI-access check behind the docs site: `GET /api/check?domain=`
returns the same gate verdict `saylent gate-check` prints, as JSON. No LLM calls,
no keys, no database — $0 per use by design.

A **standalone Vercel project**, not part of the app or the website build.
`scripts/build.mjs` bundles `@saylent/engine`'s own `crawlSite()` /
`runDomainChecks()` **from source** with esbuild into a Vercel Build Output
API v3 tree (`.vercel/output/`), so the deployed artifact has no workspace
dependency at runtime and cannot drift from the CLI. Verify the bundle stays
free of any LLM SDK before you trust a deploy:

```bash
grep -c "openai\|@anthropic-ai\|@google/genai" .vercel/output/functions/api/check.func/index.js
# must print 0 — a non-zero count means an LLM SDK entered the graph and the
# check is no longer free
```

## Deploy it (Vercel free tier)

1. Vercel -> **Add New -> Project** -> import the `saylent` repo.
2. **Root Directory** = `services/instant-check`. Leave "Include source files
   outside of the Root Directory" **on** - `npm install` here links
   `@saylent/engine` from `packages/engine` via a `file:` dependency, so the
   build needs the sibling directory. (Once `@saylent/engine` is published to
   npm, switch that dependency to the registry version and the toggle stops
   mattering.)
3. **Framework Preset** = *Other*. Build Command = `npm run build`, Install
   Command = `npm install`. Leave Output Directory empty - Vercel uses
   `.vercel/output` when the build writes one. Both commands are also in
   this project's `vercel.json`, so this is mostly confirmation.
4. Env vars: none required. Optional `INSTANT_CHECK_ALLOWED_ORIGINS` - a
   comma-separated list of EXTRA browser origins (a preview URL, or
   `http://localhost:3000` while working on the docs site). The Pages origin
   `https://yotambraun.github.io` is always allowed and is not configurable.
5. Deploy, then smoke it:
   `curl -s "https://<project>.vercel.app/api/check?domain=example.com" | head -c 300`
   and `curl -si "https://<project>.vercel.app/api/check?domain=localhost" | head -1`
   (must be `422`).
6. Point the docs site at it: set `NEXT_PUBLIC_INSTANT_CHECK_URL` to the
   deployed URL before `npm run site:build` (see [Environment
   variables](https://yotambraun.github.io/saylent/docs/self-host/environment)).
   Unset, the home-page widget degrades to printing the `saylent gate-check`
   command instead of a broken input - a fork or a local `npm run site:dev`
   is never wrong about what works.

## Layout

| File | What it is |
|---|---|
| `src/gate.ts` | The real check: `crawlSite()` + `runDomainChecks()` from `@saylent/engine`, reduced to the public JSON. Never a copy of the checks |
| `src/handler.ts` | The whole HTTP surface, as `Request -> Response`. Every collaborator injected, so it is testable with no network |
| `src/validate.ts` | Public-hostname-only input validation (the first line; `safeFetch`'s SSRF guard is the last) |
| `src/rate-limit.ts` | Per-IP token bucket, in-memory, with its honest limits stated in the file header |
| `src/cache.ts` | 24 h per-domain result cache, in-memory, plus the CDN half via `Cache-Control` |
| `src/entry.ts` | The deployed function — a thin Node `(req, res)` adapter around `handler.ts` |
| `src/types.ts` | The public JSON contract (mirrored, as types only, in the website widget) |
| `scripts/build.mjs` | esbuild -> a Vercel Build Output API v3 tree in `.vercel/output/` |

## Commands

```bash
npm install          # cheerio + esbuild + a link to packages/engine
npm run build        # -> .vercel/output/ (this is also Vercel's build command)
npm test             # 60 unit tests, no network
npm run typecheck
```

`vitest` and `tsc` are **not** dependencies of this package: they resolve from
the monorepo root's `node_modules/.bin`, which npm puts on `PATH` for every
ancestor directory. That keeps this project's own install (and Vercel's) down to
what the deployed bundle actually needs. Run `npm install` at the repo root once
before `npm test` here.

## Run it locally

```bash
npm run build
node -e "require('node:http').createServer(require('./.vercel/output/functions/api/check.func/index.js')).listen(3001)"
curl "http://localhost:3001/api/check?domain=example.com"
```

## The rules this service lives by

- **The engine is bundled from source, never copied.** `scripts/build.mjs` makes
  esbuild follow the real `@saylent/engine` modules, so this and the CLI cannot
  drift apart.
- **`safeFetch` stays on.** `allowPrivate` is never passed; every hop is
  re-resolved and rejected if it lands on a private address.
- **No LLM call, ever.** The check must stay $0 per use. Nothing here may import
  a provider SDK — the bundle size in the build output is the tell.
- **No store.** No database, no KV, no cookie, no analytics. The only thing
  recorded is a counter in the platform log (see the privacy section of
  `website/content/docs/check.mdx`, which is a promise this code has to keep).
