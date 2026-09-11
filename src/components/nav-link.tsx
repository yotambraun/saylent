"use client";
// Shared app-shell nav link with current-page state.
// Wraps PendingLink so the click-feedback spinner is preserved, and adds the
// active treatment from settings-nav.tsx (bg-paper + font-medium + aria-current).
// Active = exact href match, or a prefix match for subroutes (so /app/settings
// stays lit on /app/settings/profile). "/app" is exact-only — it's a prefix of
// every app route, so it must never light up on a child page.
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PendingLink } from "@/components/pending-link";
import { cn } from "@saylent/report/utils";

export function NavLink({
  href,
  children,
  className,
  activeClassName = "bg-paper font-medium text-ink",
  onClick,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  activeClassName?: string;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const active =
    pathname === href || (href !== "/app" && pathname.startsWith(`${href}/`));
  return (
    <PendingLink
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(className, active && activeClassName)}
    >
      {children}
    </PendingLink>
  );
}
