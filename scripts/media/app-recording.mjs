#!/usr/bin/env node
// scripts/media/app-recording.mjs — the app walkthrough: website/public/media/app.gif.
//
// The CLI has cli.gif; the app, the second entrance, had nothing. This builds
// its twin from the screenshots screens.mjs already captured — the same real
// deployment, the same real Kestrel Uptime run — so the two recordings are the
// same kind of evidence and neither can drift from the product.
//
// There is no ffmpeg on the build machines, so the encoder is the one
// cli-recording.mjs already proved: compose each frame as SVG + PNG, flatten
// to raw RGB, and let sharp write the animated GIF. No browser, no network.
//
// The frame order and the captions come from screens.mjs (GIF_FRAMES), which
// is also the order of the tour page: the journey a user actually takes, then
// the operator chapter.
//
// Both themes. The landing and the README show this GIF beside the report
// hero, and on a dark page a light-only walkthrough was a white slab glaring
// out of a near-black column, so `app.gif` has a twin, `app-dark.gif`.
//
// The canvas is the TALLEST frame and nothing more. It used to be stretched to
// match the hero image this GIF is paired with, which left a third of every
// short frame as empty ground; pairs.mjs now fits the hero to this GIF instead,
// which is the direction that costs nothing.
//
//   node scripts/media/app-recording.mjs [--dry-run]
//
// Requires the screenshots to exist. Run `screens.mjs` first, then `hero.mjs` —
// which is the order `npm run media` uses.
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { ensureDir, MEDIA_DIR, parseFlags, printPlan, TOKENS } from "./lib.mjs";
import { GIF_FRAMES } from "./screens.mjs";

const WIDTH = 1280;
const MARGIN = 20;
const IMG_W = WIDTH - MARGIN * 2;
const CAPTION_H = 46;
const RULE_H = 5;
const SOURCE_W = 1440; // every screenshot is captured at this width
const SCALE = IMG_W / SOURCE_W;
const FRAME_MS = 3000;
const SANS = "'DejaVu Sans','Liberation Sans',Inter,system-ui,sans-serif";
const MONO = "'DejaVu Sans Mono','Liberation Mono',Menlo,Consolas,monospace";
const THEMES = ["light", "dark"];
const outFor = (theme) => join(MEDIA_DIR, theme === "dark" ? "app-dark.gif" : "app.gif");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sourceFor = (file, theme) => join(MEDIA_DIR, `app-${file}-${theme}.png`);

/** The frame chrome: paper ground, a signal rule, the caption, the step count. */
function chromeSvg(caption, index, total, { width, height, theme }) {
  const t = TOKENS[theme];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="${t.paper}"/>
  <rect x="0" y="0" width="${width}" height="${RULE_H}" fill="${t.signal}"/>
  <text x="${MARGIN}" y="${CAPTION_H - 15}" font-family="${SANS}" font-size="19" fill="${t.ink}">${esc(caption)}</text>
  <text x="${width - MARGIN}" y="${CAPTION_H - 15}" text-anchor="end" font-family="${MONO}" font-size="13" fill="${t.wire}">${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</text>
</svg>`;
}

/** The hairline around ONE frame's screenshot. Drawn around the IMAGE, not
 *  around the whole window: a short screen (a 479px operator card) boxed inside
 *  a window sized for a 1093px report reads as a broken render, while the same
 *  capture with its own border on open ground reads as a card on a page. */
function borderSvg({ width, height, theme }, box) {
  const t = TOKENS[theme];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="${box.left - 0.5}" y="${box.top - 0.5}" width="${box.width + 1}" height="${box.height + 1}" fill="none" stroke="${t.line}" stroke-width="1"/>
</svg>`;
}

export async function buildAppRecording({ dryRun = false } = {}) {
  const frames = GIF_FRAMES;
  const inputs = THEMES.flatMap((t) => frames.map((f) => sourceFor(f.file, t)));

  if (dryRun) {
    printPlan("app-recording.mjs", {
      steps: [
        `read ${frames.length} screenshots per theme, written by screens.mjs`,
        `scale every capture by ${SCALE.toFixed(3)} (${SOURCE_W}px -> ${IMG_W}px) and centre it under a ${CAPTION_H}px caption bar`,
        `encode one animated GIF per theme (${frames.length} frames x ${FRAME_MS / 1000}s = ${(frames.length * FRAME_MS) / 1000}s)`,
        frames.map((f, i) => `${i + 1}. ${f.caption}`).join(" · "),
      ],
      inputs,
      outputs: THEMES.map(outFor),
    });
    return THEMES.map(outFor);
  }

  const missing = inputs.filter((f) => !existsSync(f));
  if (missing.length) {
    console.warn(
      `  skipping the app walkthrough: ${missing.length} screenshot(s) missing. Run screens.mjs first ` +
        `(DEMO_URL + SCREENS_ADMIN_URL).\n    ${missing.join("\n    ")}`,
    );
    return [];
  }

  const { default: sharp } = await import("sharp");
  await ensureDir(MEDIA_DIR);

  // One uniform scale for every screen, so the walkthrough reads as one
  // camera moving through the app rather than a gallery of different zooms.
  const scaledByTheme = {};
  for (const theme of THEMES) {
    const scaled = [];
    for (const frame of frames) {
      const file = sourceFor(frame.file, theme);
      const source = await sharp(file).metadata();
      // Scale off the 1440px capture width, not off each file's own width: the
      // user screens are cropped to the app's content column and the operator
      // screens are the full window, and resizing each to fill the frame would
      // silently zoom one group in.
      const buffer = await sharp(file)
        .resize({ width: Math.round(source.width * SCALE) })
        .png()
        .toBuffer();
      const { width, height } = await sharp(buffer).metadata();
      scaled.push({ ...frame, buffer, width, height });
    }
    scaledByTheme[theme] = scaled;
  }

  // ONE canvas for both themes: the caption bar plus the tallest frame. Nothing
  // is stretched past that — pairs.mjs fits the hero still to this box.
  const width = WIDTH;
  const height =
    CAPTION_H + Math.max(...THEMES.flatMap((t) => scaledByTheme[t].map((s) => s.height))) + MARGIN;

  const written = [];
  for (const theme of THEMES) {
    const scaled = scaledByTheme[theme];
    const raw = [];
    for (const [i, frame] of scaled.entries()) {
      // Shorter screens sit centred in the same window instead of being
      // stretched: a 479px operator card and a 1191px report stay at one scale.
      const top = CAPTION_H + Math.round((height - CAPTION_H - MARGIN - frame.height) / 2);
      const left = Math.round((width - frame.width) / 2);
      const box = { left, top, width: frame.width, height: frame.height };
      raw.push(
        await sharp(Buffer.from(chromeSvg(frame.caption, i, scaled.length, { width, height, theme })))
          .composite([
            { input: frame.buffer, left, top },
            { input: Buffer.from(borderSvg({ width, height, theme }, box)), left: 0, top: 0 },
          ])
          // flatten() composites onto the paper ground but KEEPS the alpha
          // channel here (the SVG ground is opaque, the composited PNG is not),
          // and a 4-channel buffer declared as 3 below shears every frame into
          // stripes. removeAlpha() is what makes the raw stride honest.
          .flatten({ background: TOKENS[theme].paper })
          .removeAlpha()
          .raw()
          .toBuffer(),
      );
    }

    const out = outFor(theme);
    await sharp(Buffer.concat(raw), {
      raw: { width, height: height * raw.length, channels: 3, pageHeight: height },
    })
      .gif({ delay: raw.map(() => FRAME_MS), loop: 0, colours: 64 })
      .toFile(out);

    const { size } = await stat(out);
    console.log(`  wrote ${out} (${raw.length} frames, ${width}x${height}, ${(size / 1e6).toFixed(2)} MB)`);
    if (size > 2.5e6) {
      console.warn(`  ${out} is over 2.5 MB — GitHub will still serve it, but consider fewer colours.`);
    }
    written.push(out);
  }
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildAppRecording(parseFlags());
}
