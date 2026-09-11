// A horizontally scrollable region that SAYS it scrolls.
//
// The dashboard's "All brands" and "Recent runs" tables are `min-w-[720px]`
// inside `overflow-x-auto`, which is correct — the page must not scroll
// sideways — but on a 390px phone the rows simply ended mid-word ("needs 3
// run…", "smok…") with no hint that anything was cut off. Contained overflow
// with no affordance reads as clipped, broken content, which is the first
// screen a user sees after signing in.
//
// This is presentational and server-safe (no "use client"): a right-edge fade
// painted over the scroll container plus one line of instruction, both only
// below `sm` where the clipping actually happens. No JS, no scroll listener —
// the tables always overflow at that width, so a measured "is it scrollable?"
// state would buy nothing and cost a client bundle.
import type { ReactNode } from "react";
import { cn } from "@saylent/report/utils";

export function ScrollX({
  children,
  hint = "Scroll sideways for the rest of each row",
  className,
}: {
  children: ReactNode;
  /** what is off to the right, in the caller's own words */
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <div className="overflow-x-auto">{children}</div>
      {/* the fade sits over the scroll container, never over the page */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-card to-transparent sm:hidden"
      />
      <p className="px-6 pb-2 pt-1 font-mono text-[10px] uppercase tracking-wider text-wire sm:hidden">
        {hint} →
      </p>
    </div>
  );
}
