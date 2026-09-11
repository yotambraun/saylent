// website/app/not-found.tsx - the site's own dead end, in the site's own
// palette. Without this file Next serves its stock "404 | This page could not
// be found" on pure white, carrying the HOME page's title and description -
// so a 404 could surface in search claiming to be the homepage.
import type { Metadata } from "next";
import Link from "next/link";
import { REPO_URL, SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Page not found",
  description: "That page doesn't exist on the Saylent site.",
  // Next already emits `<meta name="robots" content="noindex">` for the
  // not-found route; declaring it again only duplicates the tag.
};

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 px-6 py-24 text-center">
        <p className="font-mono text-xs uppercase tracking-wide text-signal">404</p>
        <h1 className="font-display text-3xl text-ink sm:text-4xl">That page doesn&apos;t exist</h1>
        <p className="text-wire">
          The link is wrong or the page has moved. Everything the project documents is one click
          away.
        </p>
        <nav className="flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className="rounded-lg border border-line bg-card px-4 py-2 text-sm text-ink transition-colors hover:border-wire"
          >
            Home
          </Link>
          <Link
            href="/docs"
            className="rounded-lg border border-line bg-card px-4 py-2 text-sm text-ink transition-colors hover:border-wire"
          >
            Docs
          </Link>
          <Link
            href="/docs/quickstart"
            className="rounded-lg border border-line bg-card px-4 py-2 text-sm text-ink transition-colors hover:border-wire"
          >
            Quickstart
          </Link>
          <a
            href={REPO_URL}
            className="rounded-lg border border-line bg-card px-4 py-2 text-sm text-ink transition-colors hover:border-wire"
          >
            GitHub
          </a>
        </nav>
      </main>
    </>
  );
}
