// website/next.config.ts — confirm this against the installed Next.js version when building, not training data.
// GitHub Pages serves this repo at https://yotambraun.github.io/saylent/, a
// sub-path — so basePath/assetPrefix are set whenever the build targets
// Pages (SITE_BASE_PATH=1, set by .github/workflows/pages.yml). Local
// `npm run site:dev` / a plain `npm run site:build` stay path-less so the
// site is easy to preview at http://localhost:3000/.
import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const withMDX = createMDX();

const BASE_PATH = process.env.SITE_BASE_PATH === "1" ? "/saylent" : "";

const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: BASE_PATH,
  images: {
    // No image server on a static export (Next static-exports
    // docs: "Image Optimization" is unsupported with the default loader).
    unoptimized: true,
  },
  // website/ has no lockfile of its own, so Turbopack's root auto-detection
  // (node_modules/next/dist/docs/.../turbopack.md "Root directory") walks up
  // to the monorepo's package-lock.json — needed so hoisted node_modules/next
  // resolves. Pinning turbopack.root to website/ instead breaks that
  // resolution ("files outside of the project directory will not be
  // compiled"). The one side effect is that the wider root makes Next look
  // for a top-level `instrumentation.ts` at the monorepo root too (it finds
  // the app's own src/instrumentation.ts there) — website/instrumentation.ts
  // shadows that with a no-op so the app's Sentry wiring is never pulled in.
};

export default withMDX(config);
