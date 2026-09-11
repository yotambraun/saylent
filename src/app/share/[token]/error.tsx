"use client";
// Next 16 error boundary for the shared dossier — the customer-facing deliverable
// that clients open from a link. It must degrade to a calm branded card, never a
// white crash. Dark-aware via the root layout's tokens. Mirrors app/error.tsx.
import { useEffect } from "react";
import { captureError } from "@/lib/sentry";
import { Button } from "@saylent/report/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@saylent/report/ui/card";

export default function ShareError({
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
    captureError(error, { boundary: "share", digest: error.digest });
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-24">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">This report didn&apos;t load</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm text-wire">
          <p>
            Something went wrong opening this report. Nothing you did. Try again; if the
            link keeps failing, ask whoever shared it for a fresh one.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => reset()}>Try again</Button>
          </div>
          {error.digest && (
            <p className="font-mono text-xs text-wire">Reference: {error.digest}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
