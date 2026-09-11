// website/source.config.ts — confirm this against the installed fumadocs-mdx version when building, not training data.
// Defines the `docs` MDX collection fumadocs-mdx compiles at build/dev time
// into `.source/` (gitignored). Content itself is skeleton-only in this step.
import { defineDocs, defineConfig } from "fumadocs-mdx/config";

export const docs = defineDocs({
  dir: "content/docs",
});

export default defineConfig();
