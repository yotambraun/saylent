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

/** Breathing room under the last whole line or card a crop keeps. */
const CROP_PAD = 14;

// Stable ids rendered by packages/report (verified against the built
// report.html): the four receipts, in README order.
// Every crop is cut on a WHOLE line or a whole card (wholeBlockBottomScript
// below), never at a fixed pixel height: the verdict receipt used to end in the
// middle of a sentence and the fix receipt in the middle of a JSON block, which
// is the one thing a "receipt" may never look like. `maxHeight` is now a
// ceiling the cut is searched under, not the cut itself.
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
  { file: "receipt-fix", selector: "#fix-schema_missing", maxHeight: 636, openDetails: true },
];

/** The two lowest WHOLE boundaries inside `el` that still fit under `limit`,
 *  in document coordinates:
 *    element — the bottom edge of the last element that fits (a card border, a
 *              table row, a finished paragraph, with its own padding below it)
 *    line    — the bottom of the last text LINE that fits, for the case where
 *              the limit lands inside a paragraph and there is no block edge
 *              to use.
 *  Cutting at one of these is what makes a crop end on a finished sentence or
 *  a finished card instead of slicing one in half. Zeros when nothing fits. */
function wholeBlockBottoms([selector, rawLimit, minHeight]) {
  const el = document.querySelector(selector);
  if (!el) return null;
  // 1px of slack: the caller's limit is built from a ROUNDED box, so a section
  // that fits exactly can otherwise miss its own bottom edge by half a pixel
  // and get cut at its last child instead.
  const limit = rawLimit + 1;
  const top = el.getBoundingClientRect().top + window.scrollY;
  let element = 0;
  let line = 0;
  const tops = [];
  // element edges: the section's OWN bottom first (so a section that fits
  // whole is kept whole, rather than stopping at its last child and losing its
  // closing padding), then card borders, table rows, list items, code blocks
  for (const node of [el, ...el.querySelectorAll("*")]) {
    const r = node.getBoundingClientRect();
    if (r.height < 1 || r.width < 1) continue;
    const bottom = r.bottom + window.scrollY;
    if (bottom <= limit && bottom > element) element = bottom;
    if (node !== el) tops.push(r.top + window.scrollY);
  }
  // and the individual LINE boxes of every text node, so a paragraph that runs
  // past the limit is cut between two of its lines, never through one
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.height < 1) continue;
      const bottom = r.bottom + window.scrollY;
      if (bottom <= limit && bottom > line) line = bottom;
      tops.push(r.top + window.scrollY);
    }
  }
  if (Math.max(element, line) - top < minHeight) return null;
  // where the NEXT thing starts, so breathing room under a block edge can never
  // reach far enough to show the first pixels of the line below it
  const after = tops.filter((t) => t > element + 1);
  return {
    element: Math.round(element),
    line: Math.round(line),
    top: Math.round(top),
    nextTop: after.length ? Math.round(Math.min(...after)) : Infinity,
  };
}

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
        // Park the section's own TOP at the top of the viewport. The fix card
        // is taller than the frame once its draft is expanded, and
        // scrollIntoViewIfNeeded then parks its BOTTOM in view — which is how
        // that receipt came out starting halfway through a sentence.
        await el.evaluate((node) => {
          window.scrollTo(0, Math.max(0, node.getBoundingClientRect().top + window.scrollY - 8));
        });
        await page.waitForTimeout(250);
        // DOCUMENT coordinates, not the viewport ones elementHandle.boundingBox()
        // returns: the screenshot below is `fullPage`, so its clip is read
        // against the whole document. Mixing the two silently captures the top
        // of the report for every crop.
        const box = await el.evaluate((node) => {
          const r = node.getBoundingClientRect();
          return {
            x: Math.round(r.left + window.scrollX),
            y: Math.round(r.top + window.scrollY),
            width: Math.round(r.width),
            height: Math.round(r.height),
          };
        });
        if (!box || box.width < 1 || box.height < 1) {
          console.warn(`  skipped ${crop.file} (${crop.selector} has no box)`);
          continue;
        }
        // A tall section is clipped rather than shrunk, so the crop stays
        // legible at README width instead of becoming an unreadable strip —
        // but the cut lands on a whole line or a whole card, never mid-word.
        const limit = box.y + Math.min(box.height, crop.maxHeight);
        const cuts = await page.evaluate(wholeBlockBottoms, [
          crop.selector,
          limit,
          Math.min(240, box.height),
        ]);
        // A BLOCK edge wins whenever one exists that still leaves a usable
        // crop: it ends the picture on a finished paragraph or a finished card,
        // with that block's own padding under it. A line edge is the fallback
        // for a section with no block boundary in range, and it takes NO extra
        // padding — padding past a line box is padding into the top of the next
        // line, which is the half-cut sentence this is all here to stop.
        const usable = cuts && cuts.element - cuts.top >= Math.min(240, box.height);
        const bottom = !cuts
          ? limit
          : usable
            ? Math.min(limit, cuts.element + CROP_PAD, cuts.nextTop - 2)
            : cuts.line;
        const height = Math.max(80, Math.min(box.y + box.height, bottom) - box.y);
        const file = join(MEDIA_DIR, `${crop.file}-${theme}.png`);
        // fullPage, so the clip is read in DOCUMENT coordinates: a section that
        // starts above the current scroll position is captured whole instead of
        // being silently trimmed to whatever the viewport happened to hold.
        await page.screenshot({
          path: file,
          fullPage: true,
          clip: { x: box.x, y: box.y, width: box.width, height },
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
