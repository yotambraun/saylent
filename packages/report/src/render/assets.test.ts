// PREBUILT ASSETS == BUILD-AT-RENDER. The whole point of packages/cli/dist/
// assets is that a published `npx saylent` produces the SAME report.html a
// checkout does. That claim is only worth anything if something checks it, so
// this renders the fixture both ways — once from files written by the real
// build script, once from the render-time fallback — and compares the
// stylesheet hash and the document text.
//
// $0: fixtures/run.json, no network, no LLM, no database.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildReportAssets,
  ASSET_BUDGET_BYTES,
  type BuildAssetsResult,
} from "../../scripts/build-report-assets";
import { assetsFromDir, REPORT_ASSET_FILES, type ReportAssetManifest } from "./assets";
import { fixtureToReportData } from "./fixture";
import { renderReportHtml } from "./html";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const outDir = mkdtempSync(path.join(tmpdir(), "saylent-assets-"));
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

const data = fixtureToReportData(
  JSON.parse(readFileSync(path.join(repoRoot, "fixtures/run.json"), "utf8")),
);

const RENDER_OPTS = {
  title: "Fixture · Saylent report",
  generatedAt: "2026-01-01T00:00:00.000Z",
  theme: "auto" as const,
  meta: { profile: "smoke", engines: ["chatgpt"], models: {}, cost: null },
};

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The one <style> block's contents. */
function styleOf(html: string): string {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!m) throw new Error("no <style> block in the rendered report");
  return m[1];
}

/** The document with every <style>/<script> body blanked, tags stripped: the
 *  text a reader actually sees. */
function domTextOf(html: string): string {
  return squash(
    html
      .replace(/<style>[\s\S]*?<\/style>/g, "<style></style>")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "<script></script>")
      .replace(/<[^>]+>/g, " "),
  );
}

// Tailwind + esbuild + two full renders: seconds, not milliseconds (and this
// repo's dev filesystem is /mnt/c). Everything expensive runs ONCE here and the
// tests below are plain assertions over the results.
const SETUP_TIMEOUT_MS = 300_000;
let built: BuildAssetsResult;
let prebuiltHtml: string;
let fallbackHtml: string;
const fallbackNotices: string[] = [];
const prebuiltNotices: string[] = [];

beforeAll(async () => {
  built = await buildReportAssets({ repoRoot, outDir });
  const assets = assetsFromDir(outDir);
  if (!assets) throw new Error("buildReportAssets wrote no readable assets directory");
  [prebuiltHtml, fallbackHtml] = await Promise.all([
    renderReportHtml(data, {
      ...RENDER_OPTS,
      assets,
      onNotice: (m) => prebuiltNotices.push(m),
    }),
    renderReportHtml(data, { ...RENDER_OPTS, repoRoot, onNotice: (m) => fallbackNotices.push(m) }),
  ]);
}, SETUP_TIMEOUT_MS);

describe("prebuilt report assets", () => {
  it("builds report.css + report.client.js + a manifest that matches them", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(outDir, REPORT_ASSET_FILES.manifest), "utf8"),
    ) as ReportAssetManifest;
    const css = readFileSync(path.join(outDir, REPORT_ASSET_FILES.css), "utf8");
    const clientJs = readFileSync(path.join(outDir, REPORT_ASSET_FILES.clientJs), "utf8");

    expect(sha256(css)).toBe(manifest.css.sha256);
    expect(sha256(clientJs)).toBe(manifest.clientJs.sha256);
    expect(manifest.appVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(manifest.reportVersion).toMatch(/^\d+\.\d+\.\d+/);

    // the tokens the report's own components style themselves with, and the
    // print rules the dossier prints by
    expect(css).toContain("--paper");
    expect(css).toContain("prefers-color-scheme");
    expect(css).toContain("@media print");
    // a production React bundle: it mounts the report and is not a stub
    expect(clientJs).toContain("saylent-report-root");
    expect(clientJs.length).toBeGreaterThan(100_000);

    // the shipped download stays small (build-report-assets.ts fails the build
    // on this too — the assertion here is so a component import that drags in
    // half of node_modules shows up as a red test, not a fat npm package)
    expect(built.totalBytes).toBeLessThan(ASSET_BUDGET_BYTES);
  });

  it("renders the same report from prebuilt files as from a render-time build", () => {
    // same stylesheet (whitespace-insensitive) and same visible document
    expect(sha256(squash(styleOf(prebuiltHtml)))).toBe(sha256(squash(styleOf(fallbackHtml))));
    expect(domTextOf(prebuiltHtml)).toBe(domTextOf(fallbackHtml));
    // and the same hydration bundle, so the interactive behavior is identical
    expect(sha256(prebuiltHtml)).toBe(sha256(fallbackHtml));
  });

  it("keeps render-only options out of the delivered file", () => {
    // the embedded payload is what the browser hydrates from; it must carry
    // neither the builder's paths nor a second copy of the CSS
    const payload = prebuiltHtml.match(
      /<script type="application\/json" id="saylent-report-data">([\s\S]*?)<\/script>/,
    );
    expect(payload).not.toBeNull();
    const parsed = JSON.parse(payload![1]) as { options: Record<string, unknown> };
    expect(parsed.options).not.toHaveProperty("assets");
    expect(parsed.options).not.toHaveProperty("repoRoot");
    expect(parsed.options).not.toHaveProperty("onNotice");
    expect(prebuiltHtml).not.toContain(outDir);
    expect(prebuiltHtml).not.toContain(repoRoot);
  });

  it("says so (once) when it has to compile at render time, and stays quiet otherwise", () => {
    expect(fallbackNotices).toHaveLength(1);
    expect(fallbackNotices[0]).toContain("render time");
    expect(prebuiltNotices).toHaveLength(0);
  });
});
