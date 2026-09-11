// build @saylent/report into publishable JS + .d.ts.
//
// `bundle: false` preserves the source tree 1:1 under dist/ (one output file
// per input file) so the many package.json "exports" subpaths (./host,
// ./components/*, ./ui/*, ./render/*, ...) each resolve to a real file.
// react / react-dom stay peerDependencies and are never bundled; the UI
// libs (lucide-react, radix-ui, class-variance-authority, tailwind-merge,
// clsx) and @saylent/engine are regular "dependencies" — bundle:false leaves
// every one of those as a plain import for the consumer's node_modules to
// resolve, so nothing needs to be marked `external` here.
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/**/*.{ts,tsx}", "!src/**/*.test.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  bundle: false,
  // .d.ts files come from a separate `tsc -p tsconfig.build.json
  // --emitDeclarationOnly` pass (the package "build" script runs both) —
  // see tsconfig.build.json for why.
  dts: false,
  sourcemap: true,
  clean: true,
  outDir: "dist",
});
