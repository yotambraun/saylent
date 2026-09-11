// `server-only` is a Next build-time alias, not a real npm module (see
// scripts/server-only.stub.ts). Vitest needs the same no-op mapping so lib tests
// can import service-role modules; `next build` never reads this file, so the
// real client-bundle guard stays in force.
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": path.resolve(process.cwd(), "scripts/server-only.stub.ts"),
      // Match the app's tsconfig "@/*" → "src/*" path so tests can collect
      // modules that use absolute imports.
      "@": path.resolve(process.cwd(), "src"),
    },
  },
  test: {
    // Root src/** tests, the workspace packages (@saylent/engine,
    // @saylent/report), operator scripts that carry their own unit tests (e.g.
    // pseudonymize-run.test.ts), and services/** — the standalone deployables
    // (services/instant-check) whose tests used to run only from inside their own
    // directory, which meant CI never saw them fail. .tsx is included because one
    // of them renders the docs-site widget to a string.
    include: [
      "src/**/*.test.ts",
      "packages/**/*.test.ts",
      "scripts/**/*.test.ts",
      "services/**/*.test.{ts,tsx}",
    ],
  },
});
