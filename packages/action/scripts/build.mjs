// `npm run build:action` — packages/action/src/entry.ts -> packages/action/dist/index.js.
//
// A GitHub Action resolved via `uses: yotambraun/saylent@v1` gets ONLY a checkout of
// the repo at that ref — GitHub never runs `npm install` for a JavaScript action, so
// dist/index.js must be fully self-contained. Unlike packages/cli/scripts/build.mjs
// (which keeps real npm deps external because the CLI IS installed via npm/npx),
// this build bundles EVERYTHING: @saylent/engine's source (no build step of its own,
// same reason as the CLI build), @actions/core, and cheerio (the one real runtime
// dependency crawlSite/util.ts pull in — see packages/action/src/main.ts's comment on
// why zod/openai/@anthropic-ai/sdk/@google/genai are NOT part of this graph: only
// submodules of @saylent/engine that gate-check actually needs are imported, and every
// other module they touch (config.ts, run-audit.ts's Fetcher type, etc.) is imported
// with `import type`, so esbuild elides it entirely).
//
// CommonJS output (not ESM, unlike the CLI) — the most compatible target for a
// JavaScript action's `main:` entry regardless of any nearby package.json "type"
// field.
//
// dist/index.js is COMMITTED (see the .gitignore exception), because that is the
// only way `uses: yotambraun/saylent@v1` can work. The build must therefore be
// deterministic: same sources in, byte-identical bundle out, so a rebuild shows
// up in `git diff` only when something really changed. esbuild is deterministic
// for a fixed input set; nothing below injects a timestamp, a build id, or an
// absolute path (minify strips the per-module path banners).
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const actionDir = path.resolve(here, "..");

await build({
  entryPoints: [path.join(actionDir, "src/entry.ts")],
  outfile: path.join(actionDir, "dist/index.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  // The language baseline the bundle is compiled down to. Kept at node20 (which
  // runs unmodified on the node24 runtime action.yml asks for) so the same file
  // also works for anyone pinning an older self-hosted runner.
  target: "node20",
  // No external allowlist — a consumer of this Action never runs `npm install`,
  // so every real dependency (cheerio, @actions/core) must be inlined. Node
  // builtins (fs, path, node:dns/promises, ...) stay external automatically
  // under platform: "node".
  external: [],
  // Strips esbuild's per-module debug banners (each bundled source file otherwise
  // leaves its own repo path as a comment) — dist/index.js must not carry raw paths.
  minify: true,
  logLevel: "info",
});

// packages/action/package.json declares "type": "module" (its src/*.ts is ESM,
// consistent with the rest of the monorepo) — without a closer package.json, plain
// `node` would walk up and load this CJS-format dist/index.js AS ESM and crash on
// `require`. A one-line package.json inside dist/ pins the format unambiguously,
// exactly the way esbuild's own docs recommend for a CJS/ESM split like this.
writeFileSync(path.join(actionDir, "dist/package.json"), `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);

console.log(`built ${path.relative(process.cwd(), path.join(actionDir, "dist/index.js"))}`);
