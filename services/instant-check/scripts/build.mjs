// `npm run build` inside services/instant-check — src/entry.ts -> a complete
// Vercel Build Output API v3 tree in .vercel/output/.
//
// WHY THE BUILD OUTPUT API and not a plain `api/check.ts`: this project is
// imported into Vercel with Root Directory = services/instant-check, so at
// deploy time nothing outside that directory is guaranteed to be there. Writing
// .vercel/output ourselves means Vercel deploys EXACTLY the bundle esbuild
// produced — no framework detection, no second bundler, no resolution of
// @saylent/engine at deploy time. Same reasoning as
// packages/action/scripts/build.mjs: the consumer never runs `npm install`, so
// everything must already be inside the artifact.
//
// The engine is BUNDLED FROM SOURCE, never copied: esbuild follows the real
// `@saylent/engine/crawl`, `/domainChecks`, `/memory-writer`, `/util` modules
// (they ship as raw TypeScript, which is why they cannot be an external), so
// the hosted check and `saylent gate-check` cannot drift apart. cheerio and
// undici, the two real npm dependencies in that graph, are inlined too (both
// declared in this package.json so a root-directory install has them). zod / openai /
// @anthropic-ai/sdk / @google/genai are NOT in the graph — src/gate.ts imports
// only those four submodules, and everything else they touch (config.ts's
// ExtraBot, run-audit.ts's Fetcher) is imported with `import type`, which
// esbuild elides. Check the reported bundle size if that ever changes.
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serviceDir = path.resolve(here, "..");
const outputDir = path.join(serviceDir, ".vercel/output");
const funcDir = path.join(outputDir, "functions/api/check.func");

mkdirSync(funcDir, { recursive: true });
mkdirSync(path.join(outputDir, "static"), { recursive: true });

const result = await build({
  entryPoints: [path.join(serviceDir, "src/entry.ts")],
  outfile: path.join(funcDir, "index.js"),
  bundle: true,
  platform: "node",
  // CommonJS, like the Action's bundle: the most compatible shape for a
  // launcher that loads the file directly, regardless of any nearby
  // package.json "type" field.
  format: "cjs",
  target: "node20",
  external: [],
  // The engine sources live in a sibling directory, so Node's upward lookup
  // from packages/engine/src never reaches this service's node_modules. On
  // Vercel that is the ONLY node_modules there is; point esbuild at it.
  nodePaths: [path.join(serviceDir, "node_modules")],
  // Strips esbuild's per-module banners, which would otherwise leave this
  // repo's absolute paths in the deployed artifact.
  minify: true,
  metafile: true,
  logLevel: "info",
  // The repo's flat ESLint config lints the working tree from the root and, in
  // flat-config mode, does NOT skip dot-directories — so this artifact would be
  // linted as if it were authored source. It is generated, minified and
  // gitignored; disabling the linter inside it is the fix that needs no change
  // to the shared eslint.config.mjs. (`banner` is inserted after minification,
  // so the comment survives.)
  banner: { js: "/* eslint-disable -- generated bundle, see services/instant-check/scripts/build.mjs */" },
  // esbuild's CJS output puts the default export on `module.exports.default`.
  // Vercel's Node launcher takes `mod.default ?? mod`, but pinning it removes
  // the question entirely: module.exports IS the handler.
  footer: { js: "module.exports = module.exports.default;" },
});

// `.vc-config.json` describes ONE function to the platform.
writeFileSync(
  path.join(funcDir, ".vc-config.json"),
  `${JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.js",
      launcherType: "Nodejs",
      // The handler builds its own Request; it does not want Vercel's
      // req.body/res.json helpers.
      shouldAddHelpers: false,
      supportsResponseStreaming: false,
      // The handler's own hard timeout is 10s (src/handler.ts); this is the
      // platform backstop above it, well inside the free tier's ceiling.
      maxDuration: 15,
    },
    null,
    2,
  )}\n`,
);

// Bundled CJS next to a package.json that does not say so would be loaded as
// ESM and crash on `require` — the same one-line pin the Action's build writes.
writeFileSync(path.join(funcDir, "package.json"), `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);

// A person who opens the bare service URL should not meet a 404.
writeFileSync(
  path.join(outputDir, "static/index.html"),
  `<!doctype html>
<meta charset="utf-8">
<title>Saylent instant check</title>
<meta name="robots" content="noindex">
<body style="font:16px/1.6 system-ui;max-width:34rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:1.2rem">Saylent instant check</h1>
<p>An API, not a page. <code>GET /api/check?domain=acme.com</code> returns the
AI-access gate verdict as JSON — no keys, no LLM calls.</p>
<p><a href="https://yotambraun.github.io/saylent/docs/check/">What it checks, and what it cannot know</a></p>
</body>
`,
);

writeFileSync(path.join(outputDir, "config.json"), `${JSON.stringify({ version: 3 }, null, 2)}\n`);

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`built ${path.relative(serviceDir, path.join(funcDir, "index.js"))} (${(bytes / 1024).toFixed(0)} KB)`);
