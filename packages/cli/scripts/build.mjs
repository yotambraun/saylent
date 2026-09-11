// `npm run build:cli` — packages/cli/src/index.ts -> packages/cli/dist/saylent.js.
//
// @saylent/engine and @saylent/report ship as raw TypeScript with no build
// step of their own, so their SOURCE is bundled directly INTO
// dist/saylent.js here — that's the only way plain `node dist/saylent.js`
// (no tsx registered) can resolve them: their package.json "exports" point
// at .ts files, which plain node cannot load, and the CLI's own imports of
// them use literal specifiers esbuild can follow (engine-loader.ts).
// `external` is therefore an explicit allowlist of REAL node_modules
// dependencies (+ node builtins, handled automatically by `platform:
// "node"") rather than `packages: "external"`, which would also mark the
// two workspace packages external and reproduce the original bug.
//
// The report's CSS and hydration bundle are NOT built here and not built at
// render time either: `npm run build:cli` runs `build:report-assets` first
// (packages/report/scripts/build-report-assets.ts), which writes
// dist/assets/{report.css,report.client.js,manifest.json}. dist/saylent.js
// finds them next to itself (packages/cli/src/repo-root.ts) and inlines them,
// which is what makes a published `npx saylent` work with no repo checkout and
// no postcss/@tailwindcss/postcss/esbuild installed. Inside a checkout with no
// dist/assets, the renderer still compiles both on the fly (dev convenience).
import { build } from "esbuild";
import { chmod, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cliDir = path.resolve(here, "..");

// The REAL node_modules dependencies packages/cli declares and ships. Anything
// NOT on this list is bundled into dist/saylent.js.
//
// The report's UI libraries (lucide-react, radix-ui, class-variance-authority,
// tailwind-merge, clsx) are deliberately NOT here. They are imported by
// @saylent/report's components, which are bundled, so leaving them external
// emitted top-level `import ... from "lucide-react"` statements in a package
// that never declared any of them: they resolved only because npm HOISTS them
// out of @saylent/report, and `npx saylent --help` died with
// ERR_MODULE_NOT_FOUND under pnpm's isolated node_modules, yarn PnP or
// `npm i --install-strategy=nested`. Bundling is the smaller fix than
// declaring five more dependencies: esbuild tree-shakes them (lucide-react
// alone is 41 MB installed, of which the report uses a handful of icons), and
// the install shrinks by ~45 MB.
//
// The historical objection to bundling them was real: several of their
// transitive deps (react-remove-scroll, use-sidecar) ship CJS that calls
// `require("react")`, which under `format: "esm"` hits esbuild's
// "Dynamic require of ... is not supported" shim. The BANNER below fixes that
// properly by giving the bundle a real `require` via createRequire, which is
// the supported way to run CJS-derived code from an ESM bundle on Node.
const EXTERNAL = [
  "cheerio",
  "openai",
  "@anthropic-ai/sdk",
  "@google/genai",
  "zod",
  "react",
  "react-dom",
];

// esbuild's CJS interop shim looks for a global `require` and throws
// "Dynamic require of X is not supported" when there is none — which is the
// state of every ESM output. createRequire gives it a real one, resolved
// against this file, so bundled CJS (react-remove-scroll and friends, and any
// `require("buffer")` inside a vendored dependency) behaves exactly as it does
// under Node's own CJS loader.
const BANNER = [
  'import { createRequire as __saylentCreateRequire } from "node:module";',
  "const require = __saylentCreateRequire(import.meta.url);",
].join("\n");

// CODE SPLITTING is what makes `saylent --version` / `--help` instant.
//
// index.ts loads each command with a dynamic import(). In a SINGLE-FILE esbuild
// bundle that buys nothing: an ESM `import ... from "openai"` inside a bundled
// module is hoisted to the top of the output regardless of how lazily the
// module around it is initialised, so plain `--version` still made Node
// resolve and evaluate openai, @anthropic-ai/sdk, @google/genai, cheerio and
// react-dom before it could print a version string (measured: 1.4s of CPU,
// and ~30s of wall clock on a WSL /mnt/c checkout).
//
// With splitting: true each dynamic import() becomes its own chunk, its
// external imports go with it, and dist/saylent.js holds only the dispatcher.
// Measured on the same machine: 28.5s -> 0.03s wall, 1.15s -> 0.02s CPU.
//
// The chunks MUST stay flat next to saylent.js: repo-root.ts finds
// dist/assets/ relative to its own module URL (`<dir>/assets`), and version.ts
// reads `../package.json` the same way. A chunkNames with a subdirectory in it
// would break both. `files: ["dist"]` in package.json already ships them.
// esbuild never removes what it did not write this run, and the chunk names
// carry a content hash — so a rebuild leaves every previous run's orphaned
// chunks behind and `npm pack` would ship them. Clear the JS at the top level
// of dist/ first; dist/assets/ is written by the build:report-assets step that
// runs immediately before this one and must survive.
const distDir = path.join(cliDir, "dist");
try {
  for (const name of await readdir(distDir)) {
    if (name.endsWith(".js")) await rm(path.join(distDir, name));
  }
} catch {
  // no dist yet — the build creates it
}

await build({
  entryPoints: [path.join(cliDir, "src/index.ts")],
  outdir: distDir,
  entryNames: "saylent",
  chunkNames: "chunk-[hash]",
  splitting: true,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: EXTERNAL,
  banner: { js: BANNER },
  // Also strips esbuild's per-module debug banners/labels (each bundled
  // source file otherwise leaves its own path as a comment and as a lazy-
  // init wrapper name) — dist/saylent.js must not carry raw repo paths.
  minify: true,
  logLevel: "info",
});

const out = path.join(distDir, "saylent.js");
try {
  await chmod(out, 0o755);
} catch {
  // best effort (e.g. no-op on some filesystems) — the `node dist/saylent.js`
  // invocation the done-check uses does not need the executable bit.
}

console.log(`built ${path.relative(process.cwd(), out)}`);
