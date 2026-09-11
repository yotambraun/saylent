// THE ONE COPY of the pre-paint inline script.
//
// It is emitted verbatim by src/app/layout.tsx and allow-listed BY HASH in the
// enforced Content-Security-Policy minted in src/proxy.ts. Those two used to be
// two independent literals in two files, and on 2026-09-10 they drifted: a `js`
// class was added to the script and the hash was not recomputed, so the browser
// refused the script on every /app, /login and /share page — dark mode died and
// each page logged a CSP error. The string now lives here, once, and proxy.ts
// hashes THIS constant at module load, so drift is impossible by construction.
// A unit test (theme-script.test.ts) pins the invariant anyway.
//
// What it does, before first paint:
//   1. `js` on <html> — globals.css keeps `.reveal` sections VISIBLE by default
//      and hides them only under `.js`, so a page whose JavaScript never runs
//      shows its content instead of an all-opacity-0 document (mirrored in the
//      rendered report by packages/report/src/render/document.tsx).
//   2. `dark` on <html> when the stored choice (localStorage `saylent-theme`) is
//      dark, or there is no choice / "system" and the OS prefers dark. Matches
//      ThemeToggle in /app/settings/appearance.
//
// Keep it a single-line template literal: the hash is over these exact bytes.
export const THEME_SCRIPT = `(function(){document.documentElement.classList.add('js');try{var t=localStorage.getItem('saylent-theme');var d=t==='dark'||((!t||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;
