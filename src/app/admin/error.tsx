"use client";
// Error boundary for the whole /admin area. Without it an admin query that
// throws replaces the operator console with the app-wide crash screen and no
// way back into /admin. This keeps the operator inside the console: what broke,
// the digest to quote, and a retry that re-runs the segment.
import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@saylent/report/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@saylent/report/ui/card";
import { captureError } from "@/lib/sentry";

export default function AdminError({
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
    captureError(error, { boundary: "admin", digest: error.digest });
    console.error(error);
  }, [error]);

  return (
    <div className="flex w-full max-w-md flex-col py-12">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">This admin page failed to load</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm text-wire">
          <p>
            A query behind this screen errored. Nothing was written, and no user data was
            changed. If it keeps failing, check that the database is reachable on{" "}
            <Link href="/setup" className="text-ink underline underline-offset-2">
              /setup
            </Link>
            .
          </p>
          <div className="flex gap-2">
            <Button onClick={() => reset()}>Retry</Button>
            <Button asChild variant="outline">
              <Link href="/admin">Back to the operator home</Link>
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
