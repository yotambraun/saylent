"use client";
// Next 16 error boundary for /app/brand/[id]/questions. Nothing on this page
// spends anything, so the copy can say so plainly and offer a retry.
import { useEffect } from "react";
import { captureError } from "@/lib/sentry";
import Link from "next/link";
import { Button } from "@saylent/report/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@saylent/report/ui/card";

export default function QuestionsError({
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
    captureError(error, { boundary: "brand-questions", digest: error.digest });
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col py-24">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">
            Couldn&apos;t load your questions
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm text-wire">
          <p>
            Something went wrong reading this brand. No run was started and nothing was spent.
            Try again, or head back to your brands.
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
