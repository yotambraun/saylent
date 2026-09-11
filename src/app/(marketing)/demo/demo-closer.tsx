"use client";
// /demo one-action closer. A THIN sticky bottom bar that appears only
// AFTER the reader has scrolled ~25% into the sample (IntersectionObserver on an
// early sentinel), carries one honest line + a sign-in CTA, and is dismissible for
// the session (× → sessionStorage). Thin + safe-area padded so it never grows tall
// on mobile, and print:hidden.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@saylent/report/ui/button";

const DISMISS_KEY = "saylent-demo-closer-dismissed";

export function DemoCloser() {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [past, setPast] = useState(false);
  // Read the session dismissal in the lazy initializer (guarded for SSR). This never
  // changes the FIRST render — `show` is false until `past` flips via the observer —
  // so there is no hydration mismatch and no flash, and the effect body stays free of
  // synchronous setState (the observer callback is the only setter).
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (dismissed) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        // the sentinel sits ~25% down the page; reveal the bar once it has scrolled
        // ABOVE the viewport top (reader has committed to the document), hide it again
        // near the top so it never crowds the opening
        setPast(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [dismissed]);

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  const show = past && !dismissed;

  return (
    <>
      {/* early sentinel — ~25% down the (relative) page; the observer watches it */}
      <div ref={sentinelRef} aria-hidden className="pointer-events-none absolute left-0 top-1/4 h-px w-px" />
      <div
        role="region"
        aria-label="Run your own report"
        aria-hidden={!show}
        className={`fixed inset-x-0 bottom-0 z-50 transition-transform duration-300 ease-out print:hidden ${
          show ? "translate-y-0" : "pointer-events-none translate-y-full"
        }`}
      >
        <div className="mx-auto flex max-w-5xl items-center gap-3 border-t-2 border-signal bg-paper px-4 pt-2.5 shadow-[0_-2px_16px_rgba(20,33,43,0.10)] sm:gap-4 sm:px-6 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
          <p className="min-w-0 flex-1 text-xs leading-snug text-ink/80 sm:text-sm">
            <strong className="text-ink">This is a fictional sample, written by us.</strong> No
            engine produced these answers. Your real report runs on your live data in about ten
            minutes.
          </p>
          <div className="shrink-0">
            <Button asChild size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="shrink-0 rounded p-1 text-lg leading-none text-wire transition-colors hover:text-ink"
          >
            ×
          </button>
        </div>
      </div>
    </>
  );
}
