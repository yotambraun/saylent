#!/usr/bin/env node
// RENDER SMOKE CHECK for a delivered report.html — the gate that would have
// caught the launch bug where the write-time redaction pass rewrote tokens
// INSIDE the embedded React/Tailwind hydration bundle (`this.key=t` ->
// `key=[redacted]`, `mask-linear-from-…` -> `ma[redacted]`). The file still
// looked fine to grep, typecheck, lint and vitest: only a browser saw the
// SyntaxError, the dead hydration and eleven `.reveal` sections stuck at
// opacity 0. So this loads the actual file in Chromium and asserts it LIVES.
//
// Checks (all failures exit 1 with a named reason):
//   1. no pageerror, no console error, ever
//   2. after scrolling the whole page, every `.reveal` carries `reveal-shown`
//   3. the first tab in a [role=tablist] changes the visible row count
//   4. "Switch theme" changes the <html> class / data attribute
//   5. WARNING ONLY (for now): horizontal overflow at a 390px viewport
//
// Usage: node scripts/check-report-html.mjs <file.html>
//        npm run check:report          # examples/kestrel/report.html
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const failures = [];
const warnings = [];
const fail = (msg) => failures.push(msg);
const warn = (msg) => warnings.push(msg);

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/check-report-html.mjs <file.html>");
  process.exit(1);
}
const file = path.resolve(process.cwd(), target);
if (!existsSync(file)) {
  console.error(`check:report — no such file: ${file}`);
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "check:report needs Playwright's Chromium.\n" +
      "  npm install\n" +
      "  npx playwright install --with-deps chromium",
  );
  process.exit(1);
}

console.log(`check:report — ${path.relative(process.cwd(), file)}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// ---- 1. the page must not throw, at load or during any interaction ---------
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

try {
  await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
  // hydration is synchronous from the inlined bundle, but give React a beat
  await page.waitForTimeout(600);

  // ---- 2. scroll the whole document, then every .reveal must be shown -----
  const reveal = await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.75);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
    }
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 500));
    const all = [...document.querySelectorAll(".reveal")];
    return {
      total: all.length,
      shown: all.filter((el) => el.classList.contains("reveal-shown")).length,
      invisible: all.filter((el) => Number(getComputedStyle(el).opacity) < 0.99).length,
    };
  });
  console.log(`  reveal sections   ${reveal.shown}/${reveal.total} shown, ${reveal.invisible} still invisible`);
  if (reveal.total === 0) fail("no .reveal sections found — is this a Saylent report?");
  else if (reveal.shown !== reveal.total)
    fail(`${reveal.total - reveal.shown} of ${reveal.total} .reveal sections never got .reveal-shown`);
  if (reveal.invisible > 0) fail(`${reveal.invisible} .reveal sections are still at opacity < 1 after a full scroll`);

  // ---- 3. the first tab strip must actually switch content ---------------
  // The FIRST tab is normally the one already selected ("All"), so clicking it
  // is a legitimate no-op. We click the first tab that is NOT selected.
  const tabs = page.locator('[role="tablist"] [role="tab"], [role="tablist"] button');
  const tabCount = await tabs.count();
  let tab = null;
  for (let i = 0; i < tabCount; i++) {
    const t = tabs.nth(i);
    if ((await t.getAttribute("aria-selected")) !== "true") {
      tab = t;
      break;
    }
  }
  if (tab) {
    const label = (await tab.textContent())?.trim() ?? "?";
    const rowsBefore = await page.locator("tbody tr:visible, [role='row']:visible").count();
    await tab.click({ timeout: 5000 });
    await page.waitForTimeout(400);
    const rowsAfter = await page.locator("tbody tr:visible, [role='row']:visible").count();
    const selected = (await tab.getAttribute("aria-selected")) === "true";
    console.log(`  tab strip         "${label}" — visible rows ${rowsBefore} -> ${rowsAfter}, selected=${selected}`);
    if (!selected) fail(`clicking the "${label}" tab did not select it — dead handler?`);
    if (rowsBefore === rowsAfter)
      fail(`clicking the "${label}" tab changed no content (visible rows stayed at ${rowsBefore}) — dead handler?`);
  } else if (tabCount > 0) {
    console.log("  tab strip         every tab already selected (skipped)");
  } else {
    console.log("  tab strip         none on this page (skipped)");
  }

  // ---- 4. the theme toggle must move the root class ----------------------
  const themeBtn = page.locator('[data-report-theme-toggle], button:has-text("Switch theme")').first();
  if ((await themeBtn.count()) > 0) {
    const before = await page.evaluate(() => document.documentElement.className + "|" + (document.documentElement.dataset.theme ?? ""));
    await themeBtn.click({ timeout: 5000 });
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => document.documentElement.className + "|" + (document.documentElement.dataset.theme ?? ""));
    console.log(`  theme toggle      "${before}" -> "${after}"`);
    if (before === after) fail('"Switch theme" did not change the root class or data attribute — dead handler?');
  } else {
    console.log("  theme toggle      none on this page (skipped)");
  }

  // ---- 5. mobile overflow — WARNING ONLY while the tab strip is being fixed
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    const widest = [...document.querySelectorAll("body *")]
      .map((n) => ({ w: Math.round(n.getBoundingClientRect().right), t: n.tagName + "." + String(n.className).slice(0, 60) }))
      .sort((a, b) => b.w - a.w)[0];
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, widest };
  });
  console.log(`  mobile 390px      scrollWidth ${overflow.scrollWidth} vs clientWidth ${overflow.clientWidth}`);
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    warn(
      `horizontal overflow at 390px: scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth} ` +
        `(+${overflow.scrollWidth - overflow.clientWidth}px; widest right edge: ${overflow.widest?.t ?? "?"} @ ${overflow.widest?.w ?? "?"}px)`,
    );
  }
} finally {
  await browser.close();
}

// pageerror/console errors are collected across the whole session, so they are
// reported last — an error raised by a click matters as much as one at load.
for (const e of pageErrors) fail(`uncaught page error: ${e}`);
for (const e of consoleErrors) fail(`console error: ${e}`);

for (const w of warnings) console.warn(`  WARNING           ${w}`);

if (failures.length > 0) {
  console.error(`\ncheck:report FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\ncheck:report OK${warnings.length > 0 ? ` (${warnings.length} warning)` : ""}`);
