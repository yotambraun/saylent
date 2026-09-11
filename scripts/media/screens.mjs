#!/usr/bin/env node
// scripts/media/screens.mjs — captures screenshots of the app's screens
// against the hosted read-only demo, in both themes at 1440 and 375 px so
// the docs can pair them with <picture>.
//
//   DEMO_URL=https://demo.example node scripts/media/screens.mjs
//   node scripts/media/screens.mjs --dry-run
//
// The routes below are paths on the read-only demo deployment
// (NEXT_PUBLIC_DEMO_READONLY=1). Any route the demo does not expose is skipped
// with a warning rather than failing the run, so one missing screen never
// blocks a release.
import { join } from "node:path";
import { ensureDir, loadChromium, MEDIA_DIR, parseFlags, printPlan, withPage } from "./lib.mjs";

const SCREENS = [
  { file: "app-dashboard", path: "/app" },
  { file: "app-summary", path: "/app/brand/demo" },
  { file: "app-report", path: "/app/run/demo" },
  { file: "app-verify", path: "/app/run/demo/verify" },
  { file: "app-compare", path: "/app/compare" },
  { file: "app-fixes", path: "/app/fixes" },
  { file: "app-budget", path: "/app/settings/plan" },
  { file: "app-setup", path: "/setup" },
];

const SIZES = [
  { name: "wide", width: 1440, height: 900 },
  { name: "narrow", width: 375, height: 812 },
];

const outputs = () =>
  SCREENS.flatMap((s) =>
    SIZES.flatMap((z) => ["light", "dark"].map((t) => join(MEDIA_DIR, `${s.file}-${z.name}-${t}.png`))),
  );

export async function buildScreens({ dryRun = false } = {}) {
  const base = process.env.DEMO_URL;
  if (dryRun) {
    printPlan("screens.mjs", {
      steps: [
        `read DEMO_URL (currently ${base ? base : "unset — the generator is skipped"})`,
        `visit ${SCREENS.length} routes x ${SIZES.length} widths x 2 themes`,
      ],
      inputs: SCREENS.map((s) => `${base ?? "$DEMO_URL"}${s.path}`),
      outputs: outputs(),
    });
    return outputs();
  }
  if (!base) {
    console.log("  DEMO_URL is not set; skipping app screenshots.");
    return [];
  }

  const chromium = await loadChromium();
  await ensureDir(MEDIA_DIR);
  const written = [];
  for (const size of SIZES) {
    for (const theme of ["light", "dark"]) {
      await withPage(chromium, { width: size.width, height: size.height, theme }, async (page) => {
        for (const screen of SCREENS) {
          const url = new URL(screen.path, base).href;
          const res = await page.goto(url, { waitUntil: "networkidle" }).catch(() => null);
          if (!res || !res.ok()) {
            console.warn(`  skipped ${screen.file} (${url} returned ${res ? res.status() : "no response"})`);
            continue;
          }
          await page.waitForTimeout(500);
          const file = join(MEDIA_DIR, `${screen.file}-${size.name}-${theme}.png`);
          await page.screenshot({ path: file });
          written.push(file);
        }
      });
    }
  }
  for (const f of written) console.log(`  wrote ${f}`);
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildScreens(parseFlags());
}
