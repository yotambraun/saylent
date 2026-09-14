#!/usr/bin/env node
// scripts/media/screens.mjs — the visual tour of the app: every screen a
// self-hoster would deploy, captured from a running deployment, in both
// themes, at a fixed 1440 width. Generated, never hand-edited, so the tour
// can never drift from the app (docs/guides/COMMANDS.md, "Media").
//
// Two groups, because no single deployment can show both halves:
//
//   USER      DEMO_URL — the hosted read-only demo, where an anonymous
//             visitor is already signed in as the shared demo account.
//             Default value to use: https://saylent-demo.vercel.app
//             (kept out of the code on purpose: a generator that silently
//             reaches for a public URL is a generator that can publish a
//             screenshot of the wrong deployment. Set it explicitly.)
//
//   OPERATOR  SCREENS_ADMIN_URL — a LOCAL dev server seeded with the $0
//             fixture. The demo refuses /admin and /setup by design, so the
//             operator console can only be photographed on your own rig. A
//             Supabase session for an admin account is minted from
//             .env.local (service-role generateLink -> verifyOtp) and
//             injected as a cookie; nothing is typed, clicked or spent.
//
//   DEMO_URL=https://saylent-demo.vercel.app \
//   SCREENS_ADMIN_URL=http://localhost:3011 \
//     node --env-file=.env.local scripts/media/screens.mjs
//
//   node scripts/media/screens.mjs --dry-run     # plan only, no browser
//
// A group whose env var is unset is skipped with a warning, never a failure:
// a contributor with no demo URL and no local rig still gets the rest of the
// media set.
//
// FRAMING — every user screen is cropped to `main`, the app's content column,
// on BOTH axes (`xFrom: "main"`, `from: "main"`). One framing for all of them,
// for three reasons: the README pairs these images two-up and a pair only lines
// up if both are the same size; the left rail is a full-height column whose
// links sit at the top of the document, so any capture taken deep into a long
// page carried an empty white band beside it; and the demo banner above the
// rail put a third colour tone inside every shot. The operator screens keep the
// full 1440 window — that console has no rail to drop.
//
// CROPPING — each screen declares the region that carries its meaning, as
// selectors, not pixels. `from`/`to` resolve to element boxes at capture
// time, so a layout change moves the crop instead of slicing a card in half.
// `stickyAt` is the other mode: scroll a section to the top of the viewport
// and shoot the viewport, which is how the Questions screen keeps its sticky
// cost estimate in frame above the editor.
//
// GOTCHAS, both documented in docs/guides/COMMANDS.md:
//   * scroll-reveal ghosting — report sections animate in on scroll and
//     render invisible if they never entered the viewport. Every capture
//     sweeps the page top to bottom first and pins `.reveal` visible.
//   * theme — the app stores the choice in localStorage `saylent-theme`
//     (src/lib/theme-script.ts) and toggles a `dark` class before paint.
//     Both are set here; `colorScheme` alone would only win the "system"
//     case.
import { join } from "node:path";
import { ensureDir, loadChromium, MEDIA_DIR, parseFlags, printPlan } from "./lib.mjs";

/** The Kestrel Uptime brand and run that the hosted demo is seeded with. */
const DEMO_BRAND = process.env.SCREENS_DEMO_BRAND ?? "20bfea58-b5d9-45ea-aea5-a2e6ae2774ef";
const DEMO_RUN = process.env.SCREENS_DEMO_RUN ?? "e5e84797-71cd-4861-acf9-78ee5e42feb3";

const WIDTH = 1440;
// A tall window. The two viewport-mode screens (the questions editor and the
// full report) are bounded by it, and a 1000px frame cut the report's verdicts
// table so short that its picture could not be paired with the fix tracker's
// without half the frame being padding.
const HEIGHT = 1400;
const PAD = 20;

/** The account the operator console is photographed as. Published in the
 *  screenshots, so it is a neutral reserved-domain address by default. */
export const CAPTURE_ADMIN_EMAIL = process.env.SCREENS_ADMIN_EMAIL ?? "operator@example.com";

/** User-facing screens, in the order a user meets them. */
export const DEMO_SCREENS = [
  {
    file: "dashboard",
    path: "/app",
    // one framing for every user screen: the app's content column
    from: "main",
    xFrom: "main",
    padTop: 0,
    to: "main > *",
    toLast: true,
    caption: "Your brands",
  },
  {
    file: "brand",
    path: `/app/brand/${DEMO_BRAND}`,
    // one framing for every user screen: the app's content column
    from: "main",
    xFrom: "main",
    padTop: 0,
    to: 'section:has(h2:text-is("Run history"))',
  },
  {
    file: "questions",
    path: `/app/brand/${DEMO_BRAND}/questions`,
    // The estimate card is `lg:sticky lg:top-4` (questions-client.tsx), so
    // scrolling the editor to the top of the viewport keeps the live price
    // pinned above it — one frame, both halves of the screen.
    stickyAt: 'section:has(h2:text-is("The questions"))',
    // Park the editor just under the floating estimate card (sticky at
    // top-4, ~256px tall) rather than behind it.
    stickyOffset: 278,
    // Just past the sticky card's `top-4` gap. Less than this and a sliver of
    // the section scrolling behind it shows above the card as cut-off text.
    trimTop: 22,
    // Same rail problem as the full report: crop to the editor column, and
    // stop on the fifth question's own bottom border.
    xFrom: "main",
    to: 'section:has(h2:text-is("The questions")) ol > li:nth-child(5)',
    caption: "Edit the questions, see the price",
  },
  {
    file: "run-options",
    path: `/app/brand/${DEMO_BRAND}/questions`,
    xFrom: "main",
    from: 'section:has(h2:text-is("How the run is asked"))',
    to: 'section:has(h2:text-is("How the run is asked"))',
  },
  {
    file: "confirm",
    path: `/app/brand/${DEMO_BRAND}/confirm`,
    xFrom: "main",
    from: 'section:has(p:text-is("estimated cost of this run, on your own provider credits"))',
    to: 'button:has-text("Start my audit")',
  },
  {
    file: "report-summary",
    path: `/app/run/${DEMO_RUN}`,
    // one framing for every user screen: the app's content column
    from: "main",
    xFrom: "main",
    padTop: 0,
    // Down to the end of the first row of question cards (2 columns at 1440).
    // No bottom padding: a card's own border is the edge, and 20px past it
    // shows the hairline of the row below, which reads as a clipped card.
    to: "#brief div.grid.grid-cols-1 > *:nth-child(2)",
    padBottom: 0,
    caption: "The summary",
  },
  {
    file: "report-full",
    path: `/app/run/${DEMO_RUN}?view=full`,
    // Viewport, not a clip: the dossier's contents rail is `position: sticky`,
    // and a fullPage capture renders it at its unstuck position, leaving a
    // blank column beside any region taken from deep in the page.
    stickyAt: "#verdicts",
    stickyOffset: 40,
    // ...and the app's left rail is a full-height column whose links live at
    // the top of the document, so anything captured this deep into an 11,000px
    // report would carry an empty band beside it. The crop starts at the
    // report column instead.
    xFrom: "main",
    // The verdicts table is grouped: the first tbody is the six category
    // questions, and stopping on its last row ends the picture on a complete
    // group rather than mid-group.
    to: "#verdicts tbody tr:nth-child(6)",
    padBottom: 0,
    caption: "The full report",
  },
  {
    file: "fixes",
    path: "/app/fixes",
    // one framing for every user screen: the app's content column
    from: "main",
    xFrom: "main",
    padTop: 0,
    // The tracker is one long table; it stops on a row's own bottom border so
    // the picture ends on a whole row and sits at the same height as the full
    // report it is paired with.
    to: "main table tbody tr:nth-child(5)",
    padBottom: 14,
    caption: "Fix tracker",
  },
  {
    file: "compare",
    path: "/app/compare",
    // one framing for every user screen: the app's content column
    from: "main",
    xFrom: "main",
    padTop: 0,
    to: 'section:has(h2:text-is("The counts"))',
    padBottom: 0, // a section's own edge; past it is the next section's border
    caption: "Compare rivals",
  },
  {
    file: "search",
    path: "/app/search",
    // one framing for every user screen: the app's content column
    from: "main",
    xFrom: "main",
    padTop: 0,
    // The page holds no query in its URL, so the query is typed. The search is
    // a Postgres full-text query over rows this run already saved: $0, no LLM.
    actions: [{ fill: 'input[placeholder="Try a competitor name or a topic…"]', text: "pricing", wait: 1800 }],
    to: "main > *",
    toLast: true,
  },
  {
    file: "settings-notifications",
    path: "/app/settings/notifications",
    // one framing for every user screen: the app's content column
    from: "main",
    xFrom: "main",
    padTop: 0,
    to: "main > *",
    toLast: true,
  },
  {
    file: "settings-limits",
    path: "/app/settings/limits",
    // one framing for every user screen: the app's content column
    from: "main",
    xFrom: "main",
    padTop: 0,
    to: "main > *",
    toLast: true,
  },
];

/** Operator screens. `path` may be a function of the ids discovered below. */
export const ADMIN_SCREENS = [
  { file: "setup", path: () => "/setup", to: "main > *", toLast: true },
  {
    file: "admin-providers",
    path: () => "/admin/providers",
    to: '[data-slot="card"]:has([data-slot="card-title"]:text-is("Provider keys"))',
    caption: "Operator: keys and models",
  },
  {
    file: "admin-models",
    path: () => "/admin/providers",
    from: '[data-slot="card"]:has([data-slot="card-title"]:text-is("Models per role"))',
    to: '[data-slot="card"]:has([data-slot="card-title"]:text-is("Models per role"))',
  },
  {
    file: "admin-budget",
    path: () => "/admin",
    to: "#budget-limits",
    caption: "Operator: budget and kill switch",
  },
  // The quality feed stops at the FIRST row on purpose: this rig's dev database
  // holds the maintainer's own audits of real companies under a real personal
  // address, and neither belongs in a published screenshot. The newest row is
  // the sample run, so the picture still shows the feed's columns — created,
  // brand, user, kind, health, cost, duration, artifacts — on real data.
  { file: "admin-runs", path: () => "/admin/runs", to: "table tbody tr:nth-child(1)", padBottom: 12 },
  { file: "admin-audit", path: () => "/admin/audit", to: "table" },
  { file: "admin-analytics", path: () => "/admin/analytics", to: "main > *", toLast: true },
  // The last card on the page, whichever it is: an operator with open
  // requests sees more cards than one with none.
  { file: "admin-takedowns", path: () => "/admin/takedown", to: '[data-slot="card"]', toLast: true },
  { file: "admin-users", path: (ids) => `/admin/users/${ids.userId}`, to: "main > *", toLast: true },
];

/** The one small mobile frame, so the tour can show the app is not desktop-only.
 *  Both themes: it used to be the single asset in the whole set with no dark
 *  twin, and it stayed light on a dark docs page. At 390px the rail is already
 *  collapsed, so this frame needs no `xFrom`. */
const MOBILE = {
  file: "mobile-dashboard",
  path: "/app",
  width: 390,
  height: 844,
  to: "main > *",
  toLast: true,
};

const THEMES = ["light", "dark"];
const out = (file, theme) => join(MEDIA_DIR, `app-${file}-${theme}.png`);

function plannedOutputs() {
  const demo = DEMO_SCREENS.flatMap((s) => THEMES.map((t) => out(s.file, t)));
  const admin = ADMIN_SCREENS.flatMap((s) => THEMES.map((t) => out(s.file, t)));
  return [...demo, ...admin, out(MOBILE.file, "light")];
}

/** The frames the app walkthrough GIF is built from, in story order. */
export const GIF_FRAMES = [...DEMO_SCREENS, ...ADMIN_SCREENS]
  .filter((s) => s.caption)
  .map((s) => ({ file: s.file, caption: s.caption }));

// ---------------------------------------------------------------- capture

/** Freeze motion, pin scroll-reveal sections visible, sweep the page. */
async function settle(page) {
  await page
    .addStyleTag({
      content: [
        "*,*::before,*::after{animation:none!important;transition:none!important}",
        "html{scroll-behavior:auto!important}",
        ".reveal,.js .reveal{opacity:1!important;transform:none!important}",
      ].join(""),
    })
    .catch(() => {});
  await page
    .evaluate(async () => {
      const step = window.innerHeight * 0.8;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    })
    .catch(() => {});
  await page.waitForTimeout(500);
}

/** Document-space box of a selector's first (or last) match, or null. */
async function boxOf(page, selector, which = "first") {
  const locator = page.locator(selector);
  return (which === "last" ? locator.last() : locator.first())
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
    })
    .catch(() => null);
}

async function captureOne(page, screen, base, ids, width) {
  const path = typeof screen.path === "function" ? screen.path(ids) : screen.path;
  const url = new URL(path, base).href;
  // `networkidle` never settles on some app pages (a poll keeps a socket
  // warm); wait for the document, then settle on our own terms.
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 }).catch(() => null);
  if (!res || !res.ok()) return { skipped: `${url} returned ${res ? res.status() : "no response"}` };
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(900);
  await settle(page);

  // A few screens only exist once something is typed or opened (search needs a
  // query; the bell needs a click). These are UI actions only: no run is
  // started, no provider is called, nothing is saved.
  for (const act of screen.actions ?? []) {
    if (act.fill) await page.fill(act.fill, act.text).catch(() => {});
    if (act.click) await page.click(act.click).catch(() => {});
    if (act.waitFor) await page.waitForSelector(act.waitFor, { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(act.wait ?? 900);
  }

  // Sticky mode: park a section under the viewport top and shoot the viewport.
  if (screen.stickyAt) {
    const box = await boxOf(page, screen.stickyAt);
    if (!box) return { skipped: `${url}: "${screen.stickyAt}" not found` };
    await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, box.top - (screen.stickyOffset ?? 120)));
    await page.waitForTimeout(400);
    if (!screen.xFrom && !screen.to) return { clip: null };
    const left = screen.xFrom
      ? await page
          .locator(screen.xFrom)
          .first()
          .evaluate((el) => Math.max(0, Math.round(el.getBoundingClientRect().left)))
          .catch(() => 0)
      : 0;
    const viewport = page.viewportSize();
    // An optional `to` trims the bottom to an element edge, so the frame ends
    // on a border instead of slicing whatever the viewport happened to reach.
    const stop = screen.to
      ? await page
          .locator(screen.to)
          .first()
          .evaluate((el) => Math.round(el.getBoundingClientRect().bottom))
          .catch(() => null)
      : null;
    // `trimTop` shaves the gap a sticky element leaves above itself, where a
    // sliver of the section behind it would otherwise show as cut-off text.
    const top = screen.trimTop ?? 0;
    const bottom = stop ? Math.min(viewport.height, stop + (screen.padBottom ?? 0)) : viewport.height;
    return { clip: { x: left, y: top, width: viewport.width - left, height: bottom - top }, viewport: true };
  }

  const fromBox = screen.from ? await boxOf(page, screen.from) : null;
  if (screen.from && !fromBox) return { skipped: `${url}: "${screen.from}" not found` };
  const toBox = screen.to ? await boxOf(page, screen.to, screen.toLast ? "last" : "first") : null;
  if (screen.to && !toBox) return { skipped: `${url}: "${screen.to}" not found` };

  const docHeight = await page.evaluate(() => document.body.scrollHeight);
  // `xFrom` trims the LEFT edge to a column (the app's `main`), so every user
  // screen comes out the same width and a two-up pair lines up.
  const left = screen.xFrom
    ? await page
        .locator(screen.xFrom)
        .first()
        .evaluate((el) => Math.max(0, Math.round(el.getBoundingClientRect().left)))
        .catch(() => 0)
    : 0;
  // `padTop` is the breathing room above `from`. It is 0 for the screens framed
  // on `main`: a full PAD there reaches back over main's own top edge and
  // catches a sliver of the top bar, which reads as a clipped strip.
  const top = fromBox ? Math.max(0, Math.round(fromBox.top) - (screen.padTop ?? PAD)) : 0;
  // A table row's own bottom border is the natural edge; padding past it
  // shows a sliver of the next row, which reads as a clipped card.
  const padBottom = screen.padBottom ?? PAD;
  let bottom = toBox ? Math.min(docHeight, Math.round(toBox.bottom) + padBottom) : docHeight;
  if (screen.maxHeight) bottom = Math.min(bottom, top + screen.maxHeight);
  const height = Math.max(200, bottom - top);
  return { clip: { x: left, y: top, width: width - left, height } };
}

/**
 * One browser, one context per theme, every screen in that context.
 * `dark` is set two ways because the app decides the theme two ways.
 */
async function captureGroup(chromium, { label, base, screens, cookies, ids = {}, sizes }) {
  const browser = await chromium.launch();
  const written = [];
  try {
    for (const size of sizes) {
      for (const theme of size.themes ?? THEMES) {
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          deviceScaleFactor: 1,
          colorScheme: theme,
          reducedMotion: "reduce",
          // One clock for every capture. The hosted demo runs on UTC and a
          // local rig does not, so the same run printed two different dates
          // across the user screens and the operator screens.
          timezoneId: "UTC",
          isMobile: size.width < 500,
          hasTouch: size.width < 500,
        });
        if (cookies?.length) await context.addCookies(cookies.map((c) => ({ ...c, url: base })));
        await context.addInitScript(
          ([t]) => {
            try {
              window.localStorage.setItem("saylent-theme", t);
            } catch {
              /* a context with storage blocked still has the class below */
            }
          },
          [theme],
        );
        const page = await context.newPage();
        for (const screen of size.screens ?? screens) {
          const result = await captureOne(page, screen, base, ids, size.width);
          if (result.skipped) {
            console.warn(`  skipped app-${screen.file}-${theme}.png — ${result.skipped}`);
            continue;
          }
          const file = out(screen.file, theme);
          await page.screenshot({
            path: file,
            animations: "disabled",
            ...(result.clip ? { fullPage: !result.viewport, clip: result.clip } : {}),
          });
          written.push(file);
          console.log(
            `  wrote ${file}${result.clip ? ` (${result.clip.width}x${result.clip.height} at y=${result.clip.y})` : ` (${size.width}x${size.height} viewport)`}`,
          );
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (written.length === 0) console.warn(`  ${label}: nothing captured.`);
  return written;
}

// ------------------------------------------------------- admin session

/**
 * Mint a Supabase session for an admin account, straight from .env.local, and
 * return it shaped as the cookies @supabase/ssr reads. No password, no email
 * round trip, and nothing is printed: the caller only ever sees cookie names.
 * Documented in docs/guides/COMMANDS.md, "The authed $0 rig".
 */
async function adminSession() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anonKey) {
    throw new Error(
      "operator screens need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY. Run with `node --env-file=.env.local`.",
    );
  }
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Which admin signs in decides whose address sits in the console's top bar on
  // every operator screenshot. That address is published, so it is a named
  // capture account on a reserved domain (RFC 2606), not whichever admin the
  // rig happened to create: the flagship operator screenshot used to carry
  // `walkthrough@test.local`, which reads as a leaked dev artefact.
  // SCREENS_ADMIN_EMAIL overrides it; if neither exists on this rig, fall back
  // to any reserved-domain admin and only then to the oldest one.
  const RESERVED = /@(?:[^@]*\.)?(?:example\.(?:com|net|org)|test|local|localhost|invalid)$/i;
  const { data } = await admin
    .from("profiles")
    .select("email,created_at")
    .eq("role", "admin")
    .order("created_at", { ascending: true });
  const admins = (data ?? []).map((p) => p.email).filter(Boolean);
  const wanted = process.env.SCREENS_ADMIN_EMAIL ?? CAPTURE_ADMIN_EMAIL;
  let email = admins.find((e) => e.toLowerCase() === wanted.toLowerCase());
  if (!email) {
    email = admins.find((e) => RESERVED.test(e)) ?? admins[0];
    if (email) {
      console.warn(
        `  ${wanted} is not an admin on this rig — capturing as ${email}. ` +
          "Create that account (or set SCREENS_ADMIN_EMAIL) so the console's top bar is neutral.",
      );
    }
  }
  if (!email) throw new Error("no admin profile found; set SCREENS_ADMIN_EMAIL to one.");

  // A non-admin profile makes the better /admin/users/<id> subject: it is the
  // customer an operator actually looks up.
  const { data: subjects } = await admin
    .from("profiles")
    .select("id,role")
    .order("created_at", { ascending: false })
    .limit(20);
  const userId = (subjects?.find((p) => p.role !== "admin") ?? subjects?.[0])?.id;

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError) throw new Error(`generateLink failed: ${linkError.message}`);
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: verified, error: otpError } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (otpError) throw new Error(`verifyOtp failed: ${otpError.message}`);

  const s = verified.session;
  const value = `base64-${Buffer.from(
    JSON.stringify({
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      expires_in: s.expires_in,
      expires_at: s.expires_at,
      token_type: s.token_type,
      user: s.user,
    }),
  ).toString("base64url")}`;
  // @supabase/ssr chunks the cookie at 3180 chars; a session with a fat user
  // object always overflows one cookie.
  const name = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const CHUNK = 3180;
  const cookies = [];
  if (value.length <= CHUNK) cookies.push({ name, value });
  else {
    for (let i = 0, n = 0; i < value.length; i += CHUNK, n += 1) {
      cookies.push({ name: `${name}.${n}`, value: value.slice(i, i + CHUNK) });
    }
  }
  return { cookies, ids: { userId } };
}

// ------------------------------------------------------------- generator

export async function buildScreens({ dryRun = false } = {}) {
  const demoBase = process.env.DEMO_URL;
  const adminBase = process.env.SCREENS_ADMIN_URL;

  if (dryRun) {
    printPlan("screens.mjs", {
      steps: [
        `DEMO_URL ${demoBase ? `= ${demoBase}` : "unset — the user screens are skipped (use https://saylent-demo.vercel.app)"}`,
        `SCREENS_ADMIN_URL ${adminBase ? `= ${adminBase}` : "unset — the operator screens are skipped (use a local dev server)"}`,
        `${DEMO_SCREENS.length} user screens + ${ADMIN_SCREENS.length} operator screens x 2 themes at ${WIDTH}px, plus 1 mobile frame at ${MOBILE.width}px`,
        "operator screens mint an admin Supabase session from .env.local (no clicks, no provider calls)",
      ],
      inputs: [
        ...DEMO_SCREENS.map((s) => `${demoBase ?? "$DEMO_URL"}${s.path}`),
        ...ADMIN_SCREENS.map((s) => `${adminBase ?? "$SCREENS_ADMIN_URL"}${s.path({ userId: "<user>" })}`),
      ],
      outputs: plannedOutputs(),
    });
    return plannedOutputs();
  }

  await ensureDir(MEDIA_DIR);
  const chromium = await loadChromium();
  const written = [];

  if (!demoBase) {
    console.warn("  DEMO_URL is not set; skipping the user screens (set it to https://saylent-demo.vercel.app).");
  } else {
    written.push(
      ...(await captureGroup(chromium, {
        label: "user screens",
        base: demoBase,
        screens: DEMO_SCREENS,
        sizes: [
          { width: WIDTH, height: HEIGHT },
          { ...MOBILE, screens: [MOBILE] },
        ],
      })),
    );
  }

  if (!adminBase) {
    console.warn(
      "  SCREENS_ADMIN_URL is not set; skipping the operator screens " +
        "(the hosted demo refuses /admin — point this at a local dev server).",
    );
  } else {
    const { cookies, ids } = await adminSession();
    console.log(`  minted an admin session (${cookies.length} cookie${cookies.length === 1 ? "" : "s"}).`);
    written.push(
      ...(await captureGroup(chromium, {
        label: "operator screens",
        base: adminBase,
        screens: ADMIN_SCREENS,
        cookies,
        ids,
        sizes: [{ width: WIDTH, height: HEIGHT }],
      })),
    );
  }

  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildScreens(parseFlags());
}
