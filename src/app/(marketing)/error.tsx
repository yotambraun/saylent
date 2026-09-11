"use client";
// Next 16 error boundary for the public (marketing) surface — a cold visitor
// must never hit a white crash screen. Calm, branded, dark-aware via the root
// layout's tokens. Mirrors src/app/app/error.tsx's conventions.
import { useEffect } from "react";
import { captureError } from "@/lib/sentry";
import Link from "next/link";
import { Button } from "@saylent/report/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@saylent/report/ui/card";

export default function MarketingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Forward to Sentry (a clean no-op when no DSN is configured), tagged with
    // the boundary that caught it and the digest the reader is shown, so a
    // support ticket quoting that reference lands on the right event.
    captureError(error, { boundary: "marketing", digest: error.digest });
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-24">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">This page hit a snag</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm text-wire">
          <p>
            Something went wrong on our side. Nothing you did. Try again, or head back
            to the homepage.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => reset()}>Try again</Button>
            <Button asChild variant="outline">
              <Link href="/">Back to the homepage</Link>
            </Button>
          </div>
          {error.digest && (
            <p className="font-mono text-xs text-wire">Reference: {error.digest}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
