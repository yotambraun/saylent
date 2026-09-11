// `npm run build:report-assets` — compile the report's two big strings ONCE,
// at package build time, into packages/cli/dist/assets/.
//
//   report.css        the app's globals.css through Tailwind 4 (both themes,
//                     the print blocks, the next/font substitutes) — css.ts
//   report.client.js  the hydration bundle, production + minified — bundle.ts
//   manifest.json     content hashes + the app/@saylent/report versions
//
// Same two builders the renderer used to call at render time, so the shipped
// bytes are by construction what a build-at-render pass would have produced
// (assets.test.ts proves it for the fixture). `build:cli` runs this first; the
// CLI then hands the files to renderReportHtml/renderMovementHtml and a
// published `npx saylent` needs neither this repo nor postcss/esbuild.
//
//   npx tsx packages/report/scripts/build-report-assets.ts [outDir]
//
// default outDir: packages/cli/dist/assets
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildHydrationBundle } from "../src/render/bundle";
import { buildReportCss } from "../src/render/css";
import { REPORT_ASSET_FILES, type ReportAssetManifest } from "../src/render/assets";

/** Total budget for dist/assets: the report itself is
 *  capped at 1.5 MB, and the assets are almost all of it. Breaching it is a
 *  build failure, not a warning — it is the one number that decides whether
 *  `npx saylent` stays a small download. */
export const ASSET_BUDGET_BYTES = 1_200_000;

export interface BuildAssetsResult extends ReportAssetManifest {
  outDir: string;
  totalBytes: number;
}

async function packageVersion(dir: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export async function buildReportAssets(opts: {
  repoRoot: string;
  outDir: string;
}): Promise<BuildAssetsResult> {
  const { repoRoot, outDir } = opts;
  const [css, clientJs] = await Promise.all([
    buildReportCss(repoRoot),
    // Explicit repoRoot: under tsx this module's own location would do, but the
    // arg is what makes the script correct from anywhere (see bundle.ts).
    buildHydrationBundle(repoRoot),
  ]);
  const [appVersion, reportVersion] = await Promise.all([
    packageVersion(repoRoot),
    packageVersion(path.join(repoRoot, "packages/report")),
  ]);

  const manifest: ReportAssetManifest = {
    appVersion,
    reportVersion,
    css: {
      file: REPORT_ASSET_FILES.css,
      bytes: Buffer.byteLength(css),
      sha256: sha256(css),
    },
    clientJs: {
      file: REPORT_ASSET_FILES.clientJs,
      bytes: Buffer.byteLength(clientJs),
      sha256: sha256(clientJs),
    },
  };

  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outDir, REPORT_ASSET_FILES.css), css, "utf8"),
    writeFile(path.join(outDir, REPORT_ASSET_FILES.clientJs), clientJs, "utf8"),
    writeFile(
      path.join(outDir, REPORT_ASSET_FILES.manifest),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    ),
  ]);

  return { ...manifest, outDir, totalBytes: manifest.css.bytes + manifest.clientJs.bytes };
}

async function main() {
  const repoRoot = path.resolve(import.meta.dirname, "../../..");
  const outDir = path.resolve(process.argv[2] ?? path.join(repoRoot, "packages/cli/dist/assets"));
  const built = await buildReportAssets({ repoRoot, outDir });

  const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
  const rel = (f: string) => path.relative(repoRoot, path.join(outDir, f));
  process.stdout.write(
    `report assets (app ${built.appVersion} / @saylent/report ${built.reportVersion})\n` +
      `  ${rel(built.css.file)}  ${kb(built.css.bytes)}  ${built.css.sha256.slice(0, 12)}\n` +
      `  ${rel(built.clientJs.file)}  ${kb(built.clientJs.bytes)}  ${built.clientJs.sha256.slice(0, 12)}\n` +
      `  total ${kb(built.totalBytes)} of ${kb(ASSET_BUDGET_BYTES)} budget\n`,
  );
  if (built.totalBytes > ASSET_BUDGET_BYTES) {
    process.stderr.write(
      `report assets exceed the ${kb(ASSET_BUDGET_BYTES)} budget (${kb(built.totalBytes)}).\n`,
    );
    process.exit(1);
  }
}

// Run only when invoked directly (the test imports buildReportAssets instead).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
