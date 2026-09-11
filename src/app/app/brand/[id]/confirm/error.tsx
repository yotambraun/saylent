"use client";
// Next 16 error boundary for /app/brand/[id]/confirm. Calm branded card; back link
// points to /app since the brand is already saved — nothing was spent.
import { useEffect } from "react";
import { captureError } from "@/lib/sentry";
import Link from "next/link";
import { Button } from "@saylent/report/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@saylent/report/ui/card";

export default function ConfirmError({
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
    captureError(error, { boundary: "brand-confirm", digest: error.digest });
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col py-24">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">Couldn&apos;t load your questions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm text-wire">
          <p>
            Something went wrong loading this step. Nothing you did, and no audit was spent. Try
            again, or head back to your brands.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => reset()}>Retry</Button>
            <Button asChild variant="outline">
              <Link href="/app">Back to brands</Link>
            </Button>
          </div>
          {error.digest && <p className="font-mono text-xs text-wire">Reference: {error.digest}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
