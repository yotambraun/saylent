// Public takedown intake page. Outside /app so
// the auth proxy never gates it; no data read here (the form posts to a server
// action). noindex — this is a support surface, not marketing.
import type { Metadata } from "next";
import Link from "next/link";
import { TakedownForm } from "./takedown-form";

export const metadata: Metadata = {
  title: "Request a review · Saylent",
  robots: { index: false, follow: false },
};

export default async function TakedownPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-paper px-4 py-12">
      <Link href="/" className="font-display text-lg font-semibold">
        Saylent
      </Link>
      <TakedownForm token={ref} />
      <p className="max-w-md text-center font-mono text-xs text-wire">
        Saylent reports document what public AI engines answered on a date. They are not our
        claims about your company. We still review every request in good faith.
      </p>
    </div>
  );
}
