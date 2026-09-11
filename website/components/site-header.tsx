// website/components/site-header.tsx - the one navigation bar the
// hand-built pages (landing, changelog, 404, policy) share, so "Docs" and the
// repo are never more than one click away. the landing page had
// no header at all and no Docs link anywhere on it.
//
// Server component: no state, no interactivity - just links. The docs routes
// use Fumadocs' own DocsLayout nav instead, so this is deliberately not in the
// root layout.
import Link from "next/link";

// GitHub Pages serves this repo at a sub-path (next.config.ts). A raw <img
// src> string is not rewritten by Next the way next/link is, so the prefix is
// applied by hand, the same way website/app/page.tsx does it.
const BASE_PATH = process.env.SITE_BASE_PATH === "1" ? "/saylent" : "";
const WORDMARK_LIGHT = `${BASE_PATH}/brand/wordmark-light.svg`;
const WORDMARK_DARK = `${BASE_PATH}/brand/wordmark-dark.svg`;

export const REPO_URL = "https://github.com/yotambraun/saylent";
export const LICENSE_URL = "https://github.com/yotambraun/saylent/blob/main/LICENSE";

// `narrow` links are hidden below sm: at 390px a four-item nav wraps each
// label onto two lines. Docs and GitHub are the two a stranger actually wants.
const LINKS: [label: string, href: string, narrow?: boolean][] = [
  ["Docs", "/docs", true],
  ["How it works", "/docs/how-it-works"],
  ["Self-host", "/docs/self-host"],
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
        <Link href="/" aria-label="Saylent home" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image server */}
          <img src={WORDMARK_LIGHT} alt="Saylent" width={104} height={26} className="dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image server */}
          <img
            src={WORDMARK_DARK}
            alt=""
            aria-hidden
            width={104}
            height={26}
            className="hidden dark:block"
          />
        </Link>
        <nav className="ml-auto flex items-center gap-4 text-sm text-wire sm:gap-6">
          {LINKS.map(([label, href, narrow]) => (
            <Link
              key={href}
              href={href}
              className={`${narrow ? "" : "hidden sm:inline"} hover:text-ink transition-colors`}
            >
              {label}
            </Link>
          ))}
          <a href={REPO_URL} className="hover:text-ink transition-colors">
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
