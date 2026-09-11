#!/usr/bin/env node
// scripts/media/index.mjs — `npm run media`. Regenerates every image, GIF and
// social card, in dependency order. Generators that need Chromium
// (hero, share card, app screens) are the reason .github/workflows/media.yml
// installs Playwright; the brand cards and the CLI recording need nothing but
// sharp and run anywhere.
//
//   npm run media                 everything that can run here
//   npm run media -- --dry-run    print every plan, touch nothing, exit 0
//   npm run media -- --only hero  one generator
import { buildCliRecording } from "./cli-recording.mjs";
import { buildHero } from "./hero.mjs";
import { buildOg } from "./og.mjs";
import { buildScreens } from "./screens.mjs";
import { buildShareCard } from "./share-card.mjs";
import { parseFlags } from "./lib.mjs";

const GENERATORS = [
  { name: "og", run: buildOg, needsBrowser: false },
  { name: "cli", run: buildCliRecording, needsBrowser: false },
  { name: "hero", run: buildHero, needsBrowser: true },
  { name: "share-card", run: buildShareCard, needsBrowser: true },
  { name: "screens", run: buildScreens, needsBrowser: true },
];

const flags = parseFlags();
const selected = flags.only ? GENERATORS.filter((g) => g.name === flags.only) : GENERATORS;
if (selected.length === 0) {
  console.error(`Unknown generator "${flags.only}". Known: ${GENERATORS.map((g) => g.name).join(", ")}`);
  process.exit(1);
}

let failed = 0;
for (const generator of selected) {
  console.log(`\n== ${generator.name}${flags.dryRun ? " (dry run)" : ""}`);
  try {
    await generator.run({ dryRun: flags.dryRun });
  } catch (error) {
    // A missing browser is expected off CI: report it and keep going, so the
    // generators that do not need one still produce their output.
    failed += 1;
    console.error(`  ${generator.name} failed:\n${error instanceof Error ? error.message : String(error)}`);
  }
}
if (failed > 0) {
  console.error(`\n${failed} of ${selected.length} generators did not run. See .github/workflows/media.yml for the CI setup.`);
  process.exit(1);
}
console.log("\nAll media regenerated.");
