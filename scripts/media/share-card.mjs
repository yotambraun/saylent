#!/usr/bin/env node
// scripts/media/share-card.mjs — builds the share image (the viral
// object): the report's own summary card, cropped out of the real Kestrel
// report and padded onto a branded field at the two social sizes.
//   1200x675  X / LinkedIn
//   1200x630  open graph
// It is the report's card, not a redrawing of it, so what people share is
// exactly what the tool produced.
//
//   node scripts/media/share-card.mjs [--dry-run]
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureDir, FORCE_THEME, loadChromium, MEDIA_DIR, parseFlags, printPlan, renderKestrelReport, TOKENS, withPage } from "./lib.mjs";

const SIZES = [
  { file: "share-card-1200x675.png", width: 1200, height: 675 },
  { file: "share-card-1200x630.png", width: 1200, height: 630 },
];
const CARD_SELECTOR = "#brief";

const outputs = () => SIZES.map((s) => join(MEDIA_DIR, s.file));

export async function buildShareCard({ dryRun = false } = {}) {
  if (dryRun) {
    printPlan("share-card.mjs", {
      steps: [
        "saylent report examples/kestrel/run.json --out <tmp> --format html",
        `crop ${CARD_SELECTOR} (the summary card) at 1200 px wide`,
        "letterbox onto the paper field at each social size with sharp",
      ],
      inputs: ["examples/kestrel/run.json"],
      outputs: outputs(),
    });
    return outputs();
  }

  const chromium = await loadChromium();
  const reportPath = await renderKestrelReport();
  await ensureDir(MEDIA_DIR);

  const card = await withPage(chromium, { width: 1200, height: 900, theme: "light", scale: 2 }, async (page) => {
    await page.goto(pathToFileURL(reportPath).href, { waitUntil: "load" });
    await page.evaluate(FORCE_THEME("light"));
    await page.waitForTimeout(400);
    const el = await page.$(CARD_SELECTOR);
    if (!el) throw new Error(`${CARD_SELECTOR} is not in the report; the share card cannot be built.`);
    await el.scrollIntoViewIfNeeded();
    return el.screenshot();
  });

  const { default: sharp } = await import("sharp");
  const mark = await readFile(join(MEDIA_DIR, "..", "brand", "wordmark-light.svg"));
  const written = [];
  for (const size of SIZES) {
    const pad = 48;
    const inner = await sharp(card)
      .resize({ width: size.width - pad * 2, height: size.height - pad * 2 - 56, fit: "cover", position: "top" })
      .toBuffer();
    const file = join(MEDIA_DIR, size.file);
    await sharp({
      create: { width: size.width, height: size.height, channels: 4, background: TOKENS.light.paper },
    })
      .composite([
        { input: inner, top: pad, left: pad },
        { input: await sharp(mark).resize({ height: 28 }).png().toBuffer(), top: size.height - pad, left: pad },
      ])
      .png()
      .toFile(file);
    written.push(file);
  }
  for (const f of written) console.log(`  wrote ${f}`);
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildShareCard(parseFlags());
}
