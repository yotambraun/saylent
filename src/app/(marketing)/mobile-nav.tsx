"use client";
// Marketing mobile nav — the header's links + Sign in overflow on phones, so
// under sm they collapse into a hamburger opening the same links. Desktop is
// untouched. Mirrors the app's src/app/app/mobile-nav.tsx pattern.
import Link from "next/link";
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@saylent/report/ui/sheet";
import { APP_NAME } from "@/lib/branding";

const LINKS = [
  { href: "/demo", label: "Sample report" },
  { href: "/help", label: "Help" },
  { href: "/login", label: "Sign in", strong: true },
];

export function MarketingMobileNav() {
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
      <SheetContent side="right" className="w-64">
        <SheetHeader>
          <SheetTitle className="font-display">{APP_NAME}</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1 px-4 text-sm">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={
                l.strong
                  ? "mt-2 rounded-md bg-ink px-3 py-2 text-center font-medium text-paper"
                  : "rounded-md px-3 py-2 hover:bg-paper"
              }
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
