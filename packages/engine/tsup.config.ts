// build @saylent/engine into publishable JS + .d.ts.
//
// `bundle: false` preserves the source tree 1:1 under dist/ (one output file
// per input file, "preserve modules" style) instead of rolling everything
// into a single chunk — required here because package.json "exports" hands
// out dozens of individual subpaths (./adapters, ./adapters/*, ./judge,
// ./run-audit, ...); a single bundled chunk could not satisfy that shape.
// Runtime deps (openai, @anthropic-ai/sdk, @google/genai, cheerio, zod) are
// left as plain imports for the consumer's own node_modules to resolve —
// they are declared as "dependencies" in package.json, not bundled in.
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/**/*.ts", "!src/**/*.test.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  bundle: false,
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  // The root tsconfig (extended by tsconfig.json) sets "incremental": true
  // with no tsBuildInfoFile, which tsc refuses when emitting per-file
  // declarations (TS5074). tsconfig.build.json turns incremental off and
  // enables emit, for the .d.ts pass only.
  tsconfig: "tsconfig.build.json",
});
