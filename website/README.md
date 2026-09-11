# website/

Docs site for `https://yotambraun.github.io/saylent/` (confirm behavior against the installed framework version when building).

**Stack: Option 1 — Next.js 16 static export + Fumadocs.** Chosen over the plain-MDX
fallback (Option 2) because it built cleanly on the first real attempt: `fumadocs-core`
/`fumadocs-ui`/`fumadocs-mdx` all publish `next: 16.x.x` peers, and `output: "export"`
produced a working `out/` with the `/docs/*` sidebar and MDX wired through
`source.config.ts` → `lib/source.ts`. Astro Starlight (Option 3) was not needed.

**basePath.** GitHub Pages serves this repo at a sub-path, so `SITE_BASE_PATH=1` (set by
`.github/workflows/pages.yml`) turns on `basePath: "/saylent"` in `next.config.ts`; local
`npm run site:dev`/`site:build` stay path-less. Always link with `next/link` — a raw
`<a href="/docs/...">` 404s under `/saylent/` in production.

Design tokens are a **copy**: `src/tokens.css` is copied verbatim from the app's
`src/app/globals.css` (a separate workspace can't reach across at build time).
