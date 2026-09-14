#!/usr/bin/env node
// scripts/media/pairs.mjs — the last step of `npm run media`: make every image
// that is shown TWO-UP the same size as its partner.
//
// Why this exists. The README and the landing put six pairs of assets side by
// side in a two-column table, each rendered at one fixed width (`width="460"`
// or `width="420"`). A browser scales an image to that width and keeps its
// aspect ratio, so two images of different natural sizes come out at different
// heights — and the `<sub>` captions under them land on different baselines. A
// stranger review counted all six rows misaligned, by 50 to 90 pixels each.
// Nothing in the capture scripts can fix that on its own: the crops are cut to
// content (a card, a whole line), and content is not the same height twice.
//
// So the crops stay honest and this step only changes the frame around them:
//
//   two stills   grown to the larger of the two boxes with the image's OWN edge
//                colour, sampled from the edge being extended. Type size is
//                identical across a set of stills that way — four receipts stay
//                four receipts at one size. Extra width is split evenly; extra
//                height goes at the bottom, so both images in a pair start their
//                content on the same line.
//
//   still + GIF  the GIF wins the box, and the still is fitted into it. An
//                animated GIF cannot be re-framed without re-encoding it, and
//                padding it to a taller still is what left a third of every
//                short walkthrough frame as empty ground. A report screenshot
//                beside a slideshow has no shared type size to protect, so the
//                still is scaled down (never up) and centred instead.
//
//   node scripts/media/pairs.mjs [--dry-run]
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MEDIA_DIR, parseFlags, printPlan } from "./lib.mjs";

/** Every two-up row in README.public.md and on the landing, by asset name.
 *  A `-light` / `-dark` twin is added for each PNG base automatically; a name
 *  ending in `.gif` is measured but never rewritten. */
export const PAIRS = [
  // the fold: the report beside the app walkthrough
  { row: "report hero + app walkthrough", assets: ["hero-report", "app.gif"] },
  // "What you get": the four receipts, two rows of two
  { row: "verdict + answer receipts", assets: ["receipt-verdict", "receipt-answer"] },
  { row: "gate + fix receipts", assets: ["receipt-gate", "receipt-fix"] },
  // "Inside the app": four screens, two rows of two
  { row: "dashboard + questions", assets: ["app-dashboard", "app-questions"] },
  { row: "full report + fix tracker", assets: ["app-report-full", "app-fixes"] },
  // "Operate it for others": the two operator screens
  { row: "operator providers + budget", assets: ["app-admin-providers", "app-admin-budget"] },
];

const THEMES = ["light", "dark"];

/** Asset name -> the files it stands for. */
export function filesFor(asset) {
  if (asset.endsWith(".gif")) return [{ path: join(MEDIA_DIR, asset), animated: true }];
  return THEMES.map((t) => ({ path: join(MEDIA_DIR, `${asset}-${t}.png`), animated: false }));
}

/**
 * The colour to extend an image with: the most common pixel along the edge
 * being grown. A card crop grows in the card's own white, a page crop in the
 * page's paper, and a dark asset in its own near-black — so the padding is
 * invisible rather than a grey band bolted onto the picture.
 */
async function edgeColour(sharp, path, edge) {
  const image = sharp(path);
  const { width, height } = await image.metadata();
  const region =
    edge === "bottom"
      ? { left: 0, top: Math.max(0, height - 2), width, height: Math.min(2, height) }
      : { left: 0, top: 0, width: Math.min(2, width), height };
  const { data, info } = await sharp(path)
    .extract(region)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const tally = new Map();
  for (let i = 0; i + 2 < data.length; i += info.channels) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  let best = 0;
  let bestKey = 0xffffff;
  for (const [key, n] of tally) {
    if (n > best) {
      best = n;
      bestKey = key;
    }
  }
  return { r: (bestKey >> 16) & 255, g: (bestKey >> 8) & 255, b: bestKey & 255, alpha: 1 };
}

export async function buildPairs({ dryRun = false } = {}) {
  if (dryRun) {
    printPlan("pairs.mjs", {
      steps: [
        "measure every two-up pair the README and the landing render side by side",
        "two stills: pad the smaller to the larger box with its own edge colour",
        "still + GIF: the GIF owns the box and the still is scaled down into it",
        ...PAIRS.map((p) => `${p.row}: ${p.assets.join(" + ")}`),
      ],
      inputs: PAIRS.flatMap((p) => p.assets.flatMap((a) => filesFor(a).map((f) => f.path))),
      outputs: PAIRS.flatMap((p) =>
        p.assets.flatMap((a) => filesFor(a).filter((f) => !f.animated).map((f) => f.path)),
      ),
    });
    return [];
  }

  const { default: sharp } = await import("sharp");
  const written = [];

  for (const pair of PAIRS) {
    const files = pair.assets.flatMap(filesFor).filter((f) => existsSync(f.path));
    if (files.length < 2) {
      console.warn(`  ${pair.row}: only ${files.length} asset(s) present — skipped.`);
      continue;
    }
    const sized = [];
    for (const f of files) {
      const { width, height } = await sharp(f.path).metadata();
      sized.push({ ...f, width, height });
    }
    // A GIF in the pair owns the box; otherwise the box is the larger still.
    const animated = sized.find((s) => s.animated);
    const target = animated
      ? { width: animated.width, height: animated.height }
      : {
          width: Math.max(...sized.map((s) => s.width)),
          height: Math.max(...sized.map((s) => s.height)),
        };

    for (const f of sized) {
      if (f.width === target.width && f.height === target.height) continue;
      if (f.animated) {
        console.warn(
          `  ${pair.row}: ${f.path} is ${f.width}x${f.height}, the pair is ` +
            `${target.width}x${target.height} — rebuild it with app-recording.mjs.`,
        );
        continue;
      }
      // Scale down only when something in this pair cannot be re-framed (the
      // GIF); two stills are never scaled, so a set keeps one type size.
      const fit = animated
        ? Math.min(1, target.width / f.width, target.height / f.height)
        : 1;
      const inner =
        fit < 1
          ? { width: Math.round(f.width * fit), height: Math.round(f.height * fit) }
          : { width: f.width, height: f.height };
      const dx = target.width - inner.width;
      const dy = target.height - inner.height;
      const background = await edgeColour(sharp, f.path, dy >= dx ? "bottom" : "side");
      let image = sharp(f.path);
      if (fit < 1) image = image.resize({ width: inner.width, height: inner.height });
      // Width is split evenly (content stays centred). Height goes at the
      // bottom for two stills, so both start on the same line; a scaled still
      // beside a GIF is centred, because it is a picture in a frame, not a
      // column of text.
      const buffer = await image
        .extend({
          top: fit < 1 ? Math.floor(dy / 2) : 0,
          bottom: fit < 1 ? Math.ceil(dy / 2) : dy,
          left: Math.floor(dx / 2),
          right: Math.ceil(dx / 2),
          background,
        })
        .png()
        .toBuffer();
      await sharp(buffer).toFile(f.path);
      written.push(f.path);
      console.log(
        `  ${fit < 1 ? "fitted" : "padded"} ${f.path} ${f.width}x${f.height} -> ` +
          `${target.width}x${target.height} (${pair.row})`,
      );
    }
    console.log(`  ${pair.row}: ${target.width}x${target.height}`);
  }
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildPairs(parseFlags());
}
