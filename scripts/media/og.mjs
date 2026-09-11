#!/usr/bin/env node
// scripts/media/og.mjs — builds the open-graph images and the wordmark
// + icon. Thin wrapper so `npm run media` builds the brand cards through the
// same entry point as everything else; the generator itself lives next to the
// site that consumes it (website/src/og/build.mjs) and needs no browser.
import { buildOgCards } from "../../website/src/og/build.mjs";
import { parseFlags, printPlan } from "./lib.mjs";

export async function buildOg({ dryRun = false } = {}) {
  const { outDir, written } = await buildOgCards({ dryRun });
  if (dryRun) {
    printPlan("og.mjs", {
      steps: ["build the open-graph cards as SVG and rasterize them with sharp (no browser)"],
      inputs: ["website/src/og/card.mjs", "scripts/media/icon-512.source.svg"],
      outputs: written.map((f) => `${outDir}/${f}`),
    });
  } else {
    for (const f of written) console.log(`  wrote ${outDir}/${f}`);
  }
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildOg(parseFlags());
}
