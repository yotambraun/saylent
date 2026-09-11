// The service's own test run (`npm test` inside services/instant-check). It is
// NOT part of the repo root's vitest project — the root config collects
// src/**, packages/** and scripts/**, and this directory is deliberately a
// standalone Vercel project, so it carries its own runner.
//
// `component.test.tsx` reaches across into website/src/components to render the
// docs-site widget to a string. React itself is not a dependency of this
// service; it resolves from the monorepo's root node_modules (the website and
// the app both depend on it), which is why the include below is explicit about
// where tests live rather than globbing the repo.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
