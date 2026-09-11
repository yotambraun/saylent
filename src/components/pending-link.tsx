"use client";
// Click feedback for navigation (plan 2026-07-07): useLinkStatus must be called
// from a component rendered INSIDE <Link> (next/dist/client/link.d.ts:117).
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { useLinkStatus } from "next/link";

function PendingDot() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-label="loading"
      className="ml-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent align-[-1px] opacity-70"
    />
  );
}

/** Drop-in Link that shows an inline spinner on the clicked element while the
 * next route loads — the "did my click work?" answer. */
export function PendingLink({
  children,
  ...props
}: ComponentProps<typeof Link> & { children: ReactNode }) {
  return (
    <Link {...props}>
      {children}
      <PendingDot />
    </Link>
  );
}
