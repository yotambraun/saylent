// PREBUILT REPORT ASSETS — the stylesheet and the hydration bundle as files.
//
// Both of the report's two big strings used to be produced AT RENDER TIME:
// css.ts runs Tailwind over the app's src/app/globals.css, bundle.ts runs
// esbuild over client-entry.tsx. That is fine inside a checkout of this repo
// (it is one source of truth and it can never go stale) and it is fatal for a
// published package: `npx saylent audit` would need the repo tree plus
// postcss, @tailwindcss/postcss and esbuild installed at RUNTIME just to write
// report.html.
//
// So the same two builders now also run ONCE at package build time
// (`npm run build:report-assets`, wired into `build:cli`), writing
// packages/cli/dist/assets/{report.css,report.client.js,manifest.json`}. The
// renderers take `opts.assets` and use those bytes verbatim; with no assets
// given they fall back to building at render time exactly as before. One
// source of truth either way — the shipped files are the output of the same
// two functions, hashed in the manifest so a test can prove it.
import { existsSync } from "node:fs";
import path from "node:path";
import { buildHydrationBundle } from "./bundle";
import { buildReportCss } from "./css";

/** File names inside a built assets directory. */
export const REPORT_ASSET_FILES = {
  css: "report.css",
  clientJs: "report.client.js",
  manifest: "manifest.json",
} as const;

/**
 * The two strings a static report needs, as either CONTENT or a PATH.
 *
 * A value is treated as a path when it is a single line naming an existing
 * file with the expected extension; anything else is used as literal content.
 * (Real CSS/JS content is never a one-line existing file path, and a caller
 * that wants to be unambiguous can just read the file itself.)
 */
export interface ReportAssets {
  /** compiled stylesheet: CSS text, or a path to a .css file */
  css: string;
  /** hydration bundle: JS text, or a path to a .js file */
  clientJs: string;
}

/** What build-report-assets.ts writes next to the two files. */
export interface ReportAssetManifest {
  /** version of the app/repo package the CSS tokens came from */
  appVersion: string;
  /** version of @saylent/report, which owns the components in the bundle */
  reportVersion: string;
  css: { file: string; bytes: number; sha256: string };
  clientJs: { file: string; bytes: number; sha256: string };
}

function looksLikePath(value: string, ext: string): boolean {
  if (value.length > 4096 || value.includes("\n")) return false;
  if (!value.endsWith(ext)) return false;
  return existsSync(value);
}

async function readIfPath(value: string, ext: string): Promise<string> {
  if (!looksLikePath(value, ext)) return value;
  const fs = await import("node:fs/promises");
  return fs.readFile(value, "utf8");
}

/** `<dir>/report.css` + `<dir>/report.client.js`, or null if either is missing. */
export function assetsFromDir(dir: string): ReportAssets | null {
  const css = path.join(dir, REPORT_ASSET_FILES.css);
  const clientJs = path.join(dir, REPORT_ASSET_FILES.clientJs);
  if (!existsSync(css) || !existsSync(clientJs)) return null;
  return { css, clientJs };
}

export interface ResolveAssetsOptions {
  /** prebuilt assets (content or paths) — the published-package path */
  assets?: ReportAssets;
  /** repo checkout holding src/app/globals.css — the build-at-render fallback */
  repoRoot?: string;
  /** one line about which path was taken; the CLI wires this to stderr when
   *  SAYLENT_VERBOSE is set. Never called on the prebuilt path. */
  onNotice?: (message: string) => void;
}

/** The stylesheet + hydration bundle for one render: prebuilt when given,
 *  compiled on the spot otherwise. */
export async function resolveReportAssets(
  opts: ResolveAssetsOptions,
): Promise<{ css: string; clientJs: string }> {
  if (opts.assets) {
    const [css, clientJs] = await Promise.all([
      readIfPath(opts.assets.css, ".css"),
      readIfPath(opts.assets.clientJs, ".js"),
    ]);
    return { css, clientJs };
  }
  const repoRoot = opts.repoRoot ?? process.cwd();
  opts.onNotice?.(
    `report assets: no prebuilt assets given. Compiling CSS (tailwind) and the hydration bundle (esbuild) at render time from ${repoRoot}`,
  );
  const [css, clientJs] = await Promise.all([
    buildReportCss(repoRoot),
    buildHydrationBundle(opts.repoRoot),
  ]);
  return { css, clientJs };
}
