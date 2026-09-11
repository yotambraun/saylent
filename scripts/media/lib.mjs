// scripts/media/lib.mjs — shared plumbing for the media generators.
// All generated, not hand-made, so they never go
// stale; regenerated in CI on release. Every generator here supports
// `--dry-run`, which prints the exact plan and exits 0 WITHOUT a browser, so
// the scripts can be reviewed and validated anywhere; the real runs happen in
// .github/workflows/media.yml, which installs Chromium first.
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MEDIA_DIR = join(REPO_ROOT, "website", "public", "media");
export const BRAND_DIR = join(REPO_ROOT, "website", "public", "brand");
export const KESTREL_RUN = join(REPO_ROOT, "examples", "kestrel", "run.json");
export const CLI_BUNDLE = join(REPO_ROOT, "packages", "cli", "dist", "saylent.js");

/** Brand tokens, copied from src/app/globals.css (the single source of truth). */
export const TOKENS = {
  light: { ink: "#14212b", paper: "#f7f5f0", signal: "#c8551b", wire: "#5b6b76", line: "#ded7c9" },
  dark: { ink: "#ece6da", paper: "#16130f", signal: "#e5703a", wire: "#9c9184", line: "#332c24" },
};

export function parseFlags(argv = process.argv.slice(2)) {
  const flags = { dryRun: false, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--only") flags.only = argv[++i];
  }
  return flags;
}

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Print a generator's plan in a stable, greppable shape. */
export function printPlan(name, { inputs = [], outputs = [], steps = [] }) {
  console.log(`\n${name}`);
  for (const s of steps) console.log(`  step    ${s}`);
  for (const i of inputs) console.log(`  input   ${i}`);
  for (const o of outputs) console.log(`  output  ${o}`);
}

export function run(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { stdio: "inherit", cwd: REPO_ROOT, ...opts });
    child.on("error", rej);
    child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}`))));
  });
}

const NO_BROWSER = [
  "Chromium is not available here.",
  "The media generators run in CI (.github/workflows/media.yml), which does:",
  "  npm install --no-save playwright && npx playwright install --with-deps chromium",
  "Locally, add `--dry-run` to any generator to print its plan without a browser.",
].join("\n  ");

/** Dynamic import so the repo never carries Playwright as a dependency. */
export async function loadChromium() {
  let pw;
  for (const mod of ["playwright", "playwright-core"]) {
    try {
      pw = await import(mod);
      break;
    } catch {
      /* try the next one */
    }
  }
  if (!pw?.chromium) throw new Error(`  ${NO_BROWSER}`);
  return pw.chromium;
}

/**
 * Regenerate the Kestrel sample report into a temp dir and return its path.
 * Always regenerated, never read from a committed artifact, so a screenshot can
 * never drift from the renderer: real runs only, no mock data.
 */
export async function renderKestrelReport() {
  if (!existsSync(CLI_BUNDLE)) await run("npm", ["run", "build:cli"]);
  const out = join(tmpdir(), `saylent-media-${process.pid}`);
  await rm(out, { recursive: true, force: true });
  await ensureDir(out);
  await run(process.execPath, [CLI_BUNDLE, "report", KESTREL_RUN, "--out", out, "--format", "html"]);
  return join(out, "report.html");
}

/** One browser page at a fixed size and theme, with animations frozen. */
export async function withPage(chromium, { width, height, theme, scale = 1 }, fn) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: scale,
      colorScheme: theme,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    return await fn(page);
  } finally {
    await browser.close();
  }
}

/** The report file honours the OS theme, and its own inline theme script sets
 *  BOTH classes (`dark` and `light`) on <html> so an explicit choice can beat
 *  `prefers-color-scheme` in either direction. Setting only `dark` therefore
 *  leaves a `light` class behind that keeps winning, and every "dark" media
 *  asset comes out identical to its light twin. Set both, exactly as the report
 *  does. */
export const FORCE_THEME = (theme) =>
  `document.documentElement.classList.toggle('dark', ${theme === "dark"});` +
  `document.documentElement.classList.toggle('light', ${theme === "light"})`;
