"use client";
// Mobile navigation — the sidebar is hidden under sm; phones get a hamburger
// opening the same links (journey audit 2026-07-03: no mobile nav existed).
import { NavLink } from "@/components/nav-link";
import { PendingLink as Link } from "@/components/pending-link";
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@saylent/report/ui/sheet";

const LINKS = [
  { href: "/app/onboarding", label: "+ New audit", strong: true },
  { href: "/app", label: "Brands & runs" },
  { href: "/app/fixes", label: "Fix tracker" },
  { href: "/app/compare", label: "Compare" },
  { href: "/app/search", label: "Search" },
  { href: "/app/settings", label: "Settings" },
  { href: "/demo", label: "Sample report" },
  { href: "/help", label: "Help" },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Menu"
        className="flex h-9 w-9 items-center justify-center rounded-md border border-line sm:hidden"
      >
        <span className="flex flex-col gap-1">
          <span className="h-0.5 w-4 bg-ink" />
          <span className="h-0.5 w-4 bg-ink" />
          <span className="h-0.5 w-4 bg-ink" />
        </span>
      </SheetTrigger>
      <SheetContent side="left" className="w-64">
        <SheetHeader>
          <SheetTitle className="font-display">Saylent</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1 px-4 text-sm">
          {LINKS.map((l) =>
            // the "+ New audit" CTA is an action, not a nav destination — no
            // current-page state; the rest get active highlighting via NavLink.
            l.strong ? (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="mb-2 rounded-md bg-ink px-3 py-2 text-center font-medium text-paper"
              >
                {l.label}
              </Link>
            ) : (
              <NavLink
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 hover:bg-paper"
              >
                {l.label}
              </NavLink>
            ),
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
