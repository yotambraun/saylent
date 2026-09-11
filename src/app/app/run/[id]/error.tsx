"use client";
// Next 16 error boundary for /app/run/[id] (Batch 1 safety net). Covers a bad
// run read / render; Retry re-runs the segment, or step back to the dashboard.
import { useEffect } from "react";
import { captureError } from "@/lib/sentry";
import Link from "next/link";
import { Button } from "@saylent/report/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@saylent/report/ui/card";

export default function RunError({
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
    captureError(error, { boundary: "run", digest: error.digest });
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col py-24">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">Something went wrong</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm text-wire">
          <p>
            We couldn&apos;t open this run just now. Nothing you did, and the run itself is
            untouched. Retry, or step back to your brands.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => reset()}>Retry</Button>
            <Button asChild variant="outline">
              <Link href="/app">Back to brands &amp; runs</Link>
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
