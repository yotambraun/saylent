// The public, signed-out surface: the (marketing)
// group is now help pages inside the deployment, not a sales site, so the top
// nav is minimal: logo/app name, Sample report, Help, Sign in. Footer keeps the
// legal/status links (terms, privacy, status, contact).
import Link from "next/link";
import { APP_NAME } from "@/lib/branding";
import { MarketingMobileNav } from "./mobile-nav";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line">
        <nav className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <Link href="/" className="font-display text-lg font-semibold tracking-tight">
            {APP_NAME}
          </Link>
          <div className="hidden items-center gap-6 text-sm sm:flex">
            <Link href="/demo" className="hover:underline">
              Sample report
            </Link>
            <Link href="/help" className="hover:underline">
              Help
            </Link>
            <Link
              href="/login"
              className="rounded-md bg-ink px-3 py-1.5 text-paper hover:opacity-90"
            >
              Sign in
            </Link>
          </div>
          <MarketingMobileNav />
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      {/* Organization + WebSite JSON-LD — we flag customers for missing this;
          our own site must pass our own gates (self-audit 2026-07-05) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "Organization",
                name: APP_NAME,
                url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
                description:
                  "Evidence-backed AI visibility reports: how ChatGPT, Claude, Gemini and Perplexity answer your buyers, why, and the fixes, every number with its receipt.",
              },
              {
                "@type": "WebSite",
                name: APP_NAME,
                url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
              },
            ],
          }),
        }}
      />
      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-wire">
          <span>© {new Date().getFullYear()} {APP_NAME}</span>
          <div className="flex flex-wrap gap-4">
            <Link href="/about" className="hover:underline">
              About
            </Link>
            <Link href="/help" className="hover:underline">
              Help
            </Link>
            <Link href="/status" className="hover:underline">
              Status
            </Link>
            <Link href="/terms" className="hover:underline">
              Terms
            </Link>
            <Link href="/privacy" className="hover:underline">
              Privacy
            </Link>
            {/* Contact routes through /help: it sends signed-in users to the tracked
                in-app support form and signed-out visitors to the FAQ, replacing the
                old dead mailto. */}
            <Link href="/help" className="hover:underline">
              Contact
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
