"use client";
// Unified settings — the persistent left section rail. Plain anchors in a <nav>
// (keyboard-accessible, visible focus); active item derived from usePathname.
// Desktop: vertical ~240px rail. Mobile: horizontal scrollable chip row.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@saylent/report/utils";

const SECTIONS = [
  { href: "/app/settings/profile", label: "Profile" },
  { href: "/app/settings/limits", label: "Limits" },
  { href: "/app/settings/notifications", label: "Notifications" },
  { href: "/app/settings/appearance", label: "Appearance" },
  { href: "/app/settings/brands", label: "Brands" },
  { href: "/app/settings/account", label: "Account" },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="lg:w-60 lg:shrink-0">
      <ul
        className={cn(
          "flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0",
          // hide the horizontal scrollbar on the mobile chip row
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {SECTIONS.map((s) => {
          const active = pathname === s.href;
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-card font-medium text-ink"
                    : "text-wire hover:bg-card hover:text-ink",
                )}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
