// THE REPORT STYLESHEET — one CSS string, inlined into report.html.
//
// Compiled ONCE at package build time into packages/cli/dist/assets/report.css
// (scripts/build-report-assets.ts) and re-compiled at render time only as the
// in-checkout fallback — see bundle.ts's "WHERE THIS RUNS" note; postcss and
// @tailwindcss/postcss are therefore build-time-only dependencies.
//
// It is the APP's stylesheet, not a copy of it: we run the app's globals.css
// through Tailwind 4 (the same @tailwindcss/postcss plugin `next build` uses),
// scanning the app sources AND packages/report/src (the `@source` line in
// globals.css). So the tokens, the two @media print blocks and every utility the
// Brief and the dossier use are generated from one source of truth.
//
// Three things a file on disk needs that the app gets from Next:
//   1. the next/font variables (--font-inter / --font-fraunces / --font-plex-mono)
//      have no self-hosted files here, so they fall back to system stacks. No CDN,
//      no webfont request, which is the whole point of a self-contained report.
//   2. dark mode by preference: the app's `.dark` class is set by a boot script
//      from localStorage; a file also has to answer prefers-color-scheme with no
//      JS at all, so the dark token block is re-emitted under the media query.
//   3. the page ground: the app's <body> classes come from layout.tsx.
import { createRequire } from "node:module";
import path from "node:path";

const require_ = createRequire(import.meta.url);

/** Repo-root-relative path of the app stylesheet that owns every token. */
export const APP_CSS_PATH = "src/app/globals.css";

/** System stacks for the three next/font faces, plus the offline dark-mode block
 *  and a couple of document-level rules layout.tsx would otherwise supply. */
export const OFFLINE_CSS = `
/* ---- next/font substitutes (no webfont request ever leaves this file) ---- */
:root {
  --font-inter: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-fraunces: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif;
  --font-plex-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
/* ---- the document ground (layout.tsx's <body> classes) ---- */
html { font-family: var(--font-inter); }
body { margin: 0; min-height: 100%; background: var(--paper); color: var(--ink); }
/* ---- dark by preference, with the toggle always winning ----
   The app resolves the theme from localStorage before paint. A file must also be
   correct with JS off, so the dark tokens are restated for prefers-color-scheme
   whenever the reader has not made an explicit choice (html.light / html.dark). */
@media (prefers-color-scheme: dark) {
  html:not(.light):not(.dark) {
    --ink: #ece6da;
    --paper: #16130f;
    --signal: #e5703a;
    --success: #4f9e77;
    --wire: #8f98a1;
    --line: #34302a;
    --pill-listed: #6f96b5;
    --pill-dismissed: #cd5b4c;
    --pill-absent: #47423b;
    --background: #16130f;
    --foreground: #ece6da;
    --card: #201c17;
    --card-foreground: #ece6da;
    --primary: #ece6da;
    --primary-foreground: #16130f;
    --border: #34302a;
    --input: #34302a;
    --ring: #e5703a;
    --muted-foreground: #8f98a1;
    color-scheme: dark;
  }
}
html.dark { color-scheme: dark; }
`;

/**
 * Compile the app's globals.css with Tailwind 4 and return one CSS string.
 *
 * `repoRoot` is the directory holding `src/app/globals.css` and `packages/`;
 * Tailwind's source scanning is relative to the stylesheet, which is why
 * globals.css carries `@source "../../packages/report/src"`.
 */
export async function buildReportCss(repoRoot: string): Promise<string> {
  // CJS interop: both packages export a callable as module.exports, which the
  // ESM type namespace does not describe — hence the explicit call signatures.
  const postcss = require_("postcss") as unknown as (
    plugins: import("postcss").AcceptedPlugin[],
  ) => import("postcss").Processor;
  const tailwind = require_("@tailwindcss/postcss") as unknown as (
    opts?: Record<string, unknown>,
  ) => import("postcss").AcceptedPlugin;
  const fs = await import("node:fs/promises");

  const from = path.join(repoRoot, APP_CSS_PATH);
  const source = await fs.readFile(from, "utf8");
  const result = await postcss([tailwind({ optimize: { minify: true } })]).process(source, {
    from,
    to: from,
  });
  return `${result.css}\n${OFFLINE_CSS}`;
}
