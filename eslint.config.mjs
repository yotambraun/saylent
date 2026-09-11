import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // AI assistant tooling (gitignored, not product code):
    ".claude/**",
    // Built CLI bundle (esbuild output, not authored source):
    "packages/*/dist/**", "website/.next/**", "website/out/**", "website/.source/**", "services/**/.vercel/**", "services/**/dist/**", "services/**/node_modules/**",
  ]),
  // Purity rule (open-source split, 2026-09-09): packages/engine is the
  // pure audit engine — it must be runnable standalone (CLI, GitHub Action)
  // with zero Next/Supabase/Inngest/React/app dependency. Enforce it at
  // lint time so a stray app import can't creep back in.
  {
    files: ["packages/engine/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "next",
            "next/*",
            "@supabase/*",
            "inngest",
            "inngest/*",
            "react",
            "react-dom",
            "@/*",
            "server-only",
          ],
        },
      ],
    },
  },
  // Same purity rule for packages/report (open-source split, 2026-09-09): the
  // Brief and the dossier render in the Next app AND in a static report.html the
  // CLI writes to disk, so the package must not reach for Next, Supabase, Inngest
  // or the app's "@/" alias. React IS allowed here — these are React components;
  // everything app-shaped arrives through the ReportHost context (src/host.tsx).
  {
    files: ["packages/report/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "next",
            "next/*",
            "@supabase/*",
            "inngest",
            "inngest/*",
            "@/*",
            "server-only",
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
