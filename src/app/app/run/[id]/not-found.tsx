// Next 16 not-found for /app/run/[id] — rendered when the page throws notFound()
// for a run that doesn't exist or isn't yours (RLS returns nothing). Co-located so
// it catches at THIS segment (renders between loading.js and page.js) with a real
// 404 status, in plain words — no "unverified page" jargon. Matches app/not-found.
import Link from "next/link";
import { Button } from "@saylent/report/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@saylent/report/ui/card";

export default function RunNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col py-24">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">We couldn&apos;t find that report</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm text-wire">
          <p>
            This report doesn&apos;t exist, or it belongs to another account. If you were expecting
            it, check you&apos;re signed in with the right email, then head back to your brands.
          </p>
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/app">Back to brands &amp; runs</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
