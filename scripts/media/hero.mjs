#!/usr/bin/env node
// scripts/media/hero.mjs — builds the hero image (the real Kestrel
// report, 2400x1350, both themes) and the four receipt crops used by the
// README's "What you get" section. The report HTML is regenerated from
// examples/kestrel/run.json on every run, so an image can never show a report
// the renderer no longer produces.
//
//   node scripts/media/hero.mjs [--dry-run]
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureDir, FORCE_THEME, loadChromium, MEDIA_DIR, parseFlags, printPlan, renderKestrelReport, withPage } from "./lib.mjs";

const HERO = { width: 2400, height: 1350 };

// The hero is a CROP of that viewport, not the whole 2400px frame: the report
// lays its content out in a fixed centre column, so a full-frame shot is mostly
// empty margin and the text lands unreadably small once the README scales it to
// 900px. The crop is computed in the page (heroClip below) as the content
// column plus a small gutter, from the top of the document down to the bottom
// of the FIRST row of summary cards, so no card is ever cut in half.
const HERO_GUTTER = 40;

// Stable ids rendered by packages/report (verified against the built
// report.html): the four receipts, in README order.
const CROPS = [
  // Verdict: the summary block, clipped to the headline and the three numbers.
  { file: "receipt-verdict", selector: "#brief", maxHeight: 620 },
  // Receipt: which pages each engine actually built its answer from.
  { file: "receipt-answer", selector: "#source-map", maxHeight: 560 },
  // Gate: the per-bot access checks. The table is ordered fail -> warn -> info
  // -> pass, so the `live fetch as <bot>` rows sit near the BOTTOM: the whole
  // section is kept (it is ~1150px tall, inside the viewport) rather than
  // clipped, because a crop that stops early shows only the robots.txt rows and
  // makes the README's caption read as a claim its own screenshot contradicts.
  { file: "receipt-gate", selector: "#gates", maxHeight: 1200 },
  // Fix: one drafted, evidence-anchored fix. schema_missing is chosen over the
  // other three because its card carries an actual paste-ready artifact (the
  // Organization/Product/FAQPage JSON-LD) above the fold of the crop; the
  // README promises a deliverable, so the screenshot has to contain one. The
  // artifact sits in a closed `<details>` ("Copy-ready draft"), so the crop
  // opens it first: a reader clicking that summary is one click from this exact
  // view, and a screenshot of a collapsed card proves nothing.
  { file: "receipt-fix", selector: "#fix-schema_missing", maxHeight: 560, openDetails: true },
];

/** The hero crop, measured in the page: the content column (#brief) widened by
 *  a gutter, from the document top to the bottom of the first row of summary
 *  cards. Returns null if the report has no summary block, so the caller can
 *  fall back to the plain viewport shot instead of failing the build. */
const heroClipScript = (gutter) => `(() => {
  const brief = document.getElementById("brief");
  if (!brief) return null;
  const b = brief.getBoundingClientRect();
  // The summary block holds more than one CSS grid (the three stat tiles are
  // one too); the cards are the LAST one, in document order.
  const grids = brief.querySelectorAll(".grid");
  const grid = grids.length ? grids[grids.length - 1] : null;
  const cards = grid ? [...grid.children] : [];
  const g = ${gutter};
  let bottom = b.top + b.height + g;
  if (cards.length) {
    const rects = cards.map((c) => c.getBoundingClientRect());
    const firstTop = Math.min(...rects.map((r) => r.top));
    const firstRow = rects.filter((r) => Math.abs(r.top - firstTop) < 8);
    const rowBottom = Math.max(...firstRow.map((r) => r.bottom));
    // Stop before the NEXT row starts, or a full gutter would show a sliver of
    // the row below and reintroduce the half-cut cards this crop exists to fix.
    const nextTops = rects.map((r) => r.top).filter((t) => t > firstTop + 8);
    const nextTop = nextTops.length ? Math.min(...nextTops) : Infinity;
    bottom = Math.min(rowBottom + g, nextTop - 6);
  }
  return {
    x: Math.max(0, Math.round(b.left - g)),
    y: 0,
    width: Math.round(b.width + g * 2),
    height: Math.round(bottom),
  };
})()`;

const outputs = () => [
  join(MEDIA_DIR, "hero-report-light.png"),
  join(MEDIA_DIR, "hero-report-dark.png"),
  ...CROPS.flatMap((c) => [join(MEDIA_DIR, `${c.file}-light.png`), join(MEDIA_DIR, `${c.file}-dark.png`)]),
];

export async function buildHero({ dryRun = false } = {}) {
  if (dryRun) {
    printPlan("hero.mjs", {
      steps: [
        `saylent report examples/kestrel/run.json --out <tmp> --format html`,
        `screenshot the report at ${HERO.width}x${HERO.height} in light and dark, cropped to the summary column and its first row of cards`,
        `crop ${CROPS.map((c) => c.selector).join(", ")} in both themes`,
      ],
      inputs: ["examples/kestrel/run.json"],
      outputs: outputs(),
    });
    return outputs();
  }

  const chromium = await loadChromium();
  const reportPath = await renderKestrelReport();
  const url = pathToFileURL(reportPath).href;
  await ensureDir(MEDIA_DIR);
  const written = [];

  for (const theme of ["light", "dark"]) {
    await withPage(chromium, { ...HERO, theme }, async (page) => {
      await page.goto(url, { waitUntil: "load" });
      await page.evaluate(FORCE_THEME(theme));
      // The report reveals sections on scroll. A screenshot must never catch a
      // section mid-reveal, so the entrance animation is turned off outright.
      await page.addStyleTag({ content: ".reveal{opacity:1!important;transform:none!important;animation:none!important}" });
      await page.waitForTimeout(400);
      const hero = join(MEDIA_DIR, `hero-report-${theme}.png`);
      const clip = await page.evaluate(heroClipScript(HERO_GUTTER));
      await page.screenshot(clip ? { path: hero, clip } : { path: hero });
      written.push(hero);

      for (const crop of CROPS) {
        const el = await page.$(crop.selector);
        if (!el) {
          console.warn(`  skipped ${crop.file} (${crop.selector} not in this report)`);
          continue;
        }
        if (crop.openDetails) {
          await el.evaluate((node) => {
            for (const d of node.querySelectorAll("details")) d.open = true;
          });
        }
        await el.scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        const box = await el.boundingBox();
        if (!box || box.width < 1 || box.height < 1) {
          console.warn(`  skipped ${crop.file} (${crop.selector} has no box)`);
          continue;
        }
        const file = join(MEDIA_DIR, `${crop.file}-${theme}.png`);
        // A tall section is clipped rather than shrunk, so the crop stays
        // legible at README width instead of becoming an unreadable strip.
        await page.screenshot({
          path: file,
          clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, crop.maxHeight) },
        });
        written.push(file);
      }
    });
  }
  for (const f of written) console.log(`  wrote ${f}`);
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildHero(parseFlags());
}
