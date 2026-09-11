#!/usr/bin/env node
// website/src/og/build.mjs — writes the site's open-graph cards
// as SVG + PNG under website/public/brand/. Deterministic, no browser, no
// network: the SVG is built by ./card.mjs and rasterized with sharp (already a
// dependency of the app). Run it through `npm run media`, or directly:
//   node website/src/og/build.mjs [--dry-run]
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ogCardSvg } from "./card.mjs";
import { pipelineSvg } from "./pipeline.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "public", "brand");

// One card per social surface. Page-level cards are generated from the same
// builder by passing { title, line } (see website/app/layout.tsx for where the
// default card is referenced).
const CARDS = [
  { file: "og-default", size: "og" },
  { file: "og-wide", size: "share" },
];

export async function buildOgCards({ dryRun = false } = {}) {
  const written = [];
  for (const card of CARDS) {
    const svg = ogCardSvg({ size: card.size });
    written.push(`${card.file}.svg`, `${card.file}.png`);
    if (dryRun) continue;
    await mkdir(OUT, { recursive: true });
    await writeFile(join(OUT, `${card.file}.svg`), svg, "utf8");
    const { default: sharp } = await import("sharp");
    await sharp(Buffer.from(svg)).png().toFile(join(OUT, `${card.file}.png`));
  }
  // The nine-stage pipeline diagram used by README.md. SVG
  // only: it is line art, so it stays crisp at any width and costs ~2 KB.
  for (const themeName of ["light", "dark"]) {
    written.push(`pipeline-${themeName}.svg`);
    if (!dryRun) await writeFile(join(OUT, `pipeline-${themeName}.svg`), pipelineSvg(themeName), "utf8");
  }
  // The raster app icon, from the same 512px source (wordmark
  // + icon, SVG + PNG). GitHub repo settings and npm want a PNG.
  // The source SVG lives with the other generators (scripts/media/), not in
  // public/, so only the generated PNG is served.
  written.push("icon-512.png");
  if (!dryRun) {
    const { default: sharp } = await import("sharp");
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(join(HERE, "..", "..", "..", "scripts", "media", "icon-512.source.svg"));
    await sharp(src).png().toFile(join(OUT, "icon-512.png"));
  }
  return { outDir: OUT, written };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run");
  const { outDir, written } = await buildOgCards({ dryRun });
  console.log(`${dryRun ? "[dry-run] would write" : "wrote"} ${written.length} files in ${outDir}`);
  for (const f of written) console.log(`  ${f}`);
}
