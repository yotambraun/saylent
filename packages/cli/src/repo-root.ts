// WHERE THE REPORT'S CSS + HYDRATION BUNDLE COME FROM, in priority order.
//
// 1. `dist/assets/` next to the CLI itself — report.css + report.client.js,
//    precompiled by `npm run build:report-assets` (which `build:cli` runs).
//    This is the only path a PUBLISHED `npx saylent` takes: no repo checkout,
//    no postcss/@tailwindcss/postcss/esbuild at runtime. Resolution is
//    relative to THIS MODULE's own location — never the cwd, never a repo
//    search — because a published package's files are the only thing it can
//    count on being there.
// 2. a repo checkout holding `src/app/globals.css` — the in-checkout dev
//    fallback, where the renderer compiles both at render time (that is also
//    what the Next app and vitest do). Convenience only: it keeps `npm run
//    cli` working before `build:cli` has ever been run.
//
// `import.meta.url` is correct in both shapes: under `tsx packages/cli/src/
// index.ts` it is this file (so dist/ is one level up), and inside the bundled
// packages/cli/dist/saylent.js it is that OUTPUT file (so assets/ is a sibling)
// — esbuild leaves import.meta.url pointing at the emitted file.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReportAssets } from "@saylent/report/render";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const ASSET_FILES = ["report.css", "report.client.js"] as const;

/** Candidate asset directories, nearest first: dist/saylent.js's own `assets/`,
 *  then `../dist/assets` for the un-built source layout (packages/cli/src). */
function assetDirCandidates(startDir: string): string[] {
  return [path.join(startDir, "assets"), path.resolve(startDir, "../dist/assets")];
}

/** The prebuilt assets shipped with this CLI, or null when it is running from
 *  source with no `build:cli` output. */
export function findReportAssets(startDir: string = HERE): ReportAssets | null {
  for (const dir of assetDirCandidates(startDir)) {
    const files = ASSET_FILES.map((f) => path.join(dir, f));
    if (files.every((f) => existsSync(f))) return { css: files[0], clientJs: files[1] };
  }
  return null;
}

export function findRepoRoot(startDir: string = HERE): string | null {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    if (existsSync(path.join(dir, "src", "app", "globals.css"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** The `assets` / `repoRoot` / `onNotice` half of a render call. Prebuilt
 *  assets win; inside a checkout without them the renderer rebuilds and says so
 *  once under SAYLENT_VERBOSE (the fallback is otherwise silent, because in the
 *  app and in tests it is simply the normal path). */
export function reportAssetOptions(): {
  assets?: ReportAssets;
  repoRoot?: string;
  onNotice?: (message: string) => void;
} {
  const assets = findReportAssets();
  if (assets) return { assets };
  const onNotice = process.env.SAYLENT_VERBOSE
    ? (message: string) => process.stderr.write(`${message}\n`)
    : undefined;
  return { repoRoot: findRepoRoot() ?? undefined, onNotice };
}
