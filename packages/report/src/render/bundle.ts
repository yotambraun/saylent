// THE HYDRATION BUNDLE — one esbuild pass over client-entry.tsx, inlined into
// report.html as a single <script>.
//
// WHERE THIS RUNS. Two callers, one function:
//   - package build time — scripts/build-report-assets.ts writes the output to
//     packages/cli/dist/assets/report.client.js, which is what a PUBLISHED
//     `npx saylent` inlines (no esbuild, no repo checkout at runtime).
//   - render time — the fallback inside a checkout (the Next app, vitest, `npm
//     run cli` before build:cli has ever run). ~200ms for the whole React tree,
//     nothing next to a run, and the file always matches the code that rendered
//     it. The bundle is cached per process, so a report and its movement page
//     pay for it once.
// Both paths call THIS builder, so the shipped artifact cannot be a second
// source of truth — assets.test.ts renders the fixture both ways and compares.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

let cached: Promise<string> | null = null;

/** Minified IIFE containing React, ReactDOM and the report components.
 *
 *  `repoRoot`, when given, locates client-entry.tsx as
 *  `<repoRoot>/packages/report/src/render/client-entry.tsx` instead of via
 *  this module's own `import.meta.url` (HERE). Pass it whenever the caller
 *  might be running from a SINGLE-FILE bundle (e.g. packages/cli/dist/
 *  saylent.js): once this file's code is concatenated into another output
 *  file, `import.meta.url` resolves to that OUTPUT file's location, not to
 *  packages/report/src/render/ — so HERE would point at the wrong
 *  directory and this lookup would miss. Callers that run this package's
 *  raw TypeScript source directly (the Next app, vitest) don't need it;
 *  HERE is already correct there. */
export function buildHydrationBundle(repoRoot?: string): Promise<string> {
  if (cached) return cached;
  cached = (async () => {
    const esbuild = require_("esbuild") as typeof import("esbuild");
    // A couple of pure composers sit next to engine helpers that carry a lazy
    // `import("node:dns/promises")` on a server-only path (source-map.ts ->
    // engine/util.ts). Next's client build stubs node builtins the same way; do
    // it explicitly here so the browser bundle never references one.
    const stubNodeBuiltins: import("esbuild").Plugin = {
      name: "stub-node-builtins",
      setup(build) {
        build.onResolve({ filter: /^node:/ }, (args) => ({
          path: args.path,
          namespace: "node-builtin-stub",
        }));
        build.onLoad({ filter: /.*/, namespace: "node-builtin-stub" }, () => ({
          contents: "export default {};",
          loader: "js",
        }));
      },
    };
    const entryDir = repoRoot ? path.join(repoRoot, "packages/report/src/render") : HERE;
    const result = await esbuild.build({
      plugins: [stubNodeBuiltins],
      entryPoints: [path.join(entryDir, "client-entry.tsx")],
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: ["es2020"],
      jsx: "automatic",
      minify: true,
      legalComments: "none",
      // React ships dev warnings unless it is told it is in production; the dev
      // build is ~3x the size and logs to a console nobody will read.
      define: { "process.env.NODE_ENV": '"production"' },
      logLevel: "silent",
    });
    const out = result.outputFiles?.[0];
    if (!out) throw new Error("esbuild produced no output for the report hydration bundle");
    return out.text;
  })();
  return cached;
}
