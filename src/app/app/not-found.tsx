// Next 16 nested not-found for /app — renders WITHIN the app shell (the segment
// layout wraps not-found.js, between loading.js and page.js; docs:
// node_modules/next/.../file-conventions/not-found.md). Matches app/error.tsx style.
import Link from "next/link";
import { Button } from "@saylent/report/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@saylent/report/ui/card";

export default function AppNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col py-24">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">This page doesn&apos;t exist</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm text-wire">
          <p>
            The address isn&apos;t one of your pages. It may have moved, or the link was
            mistyped. Here&apos;s the way back.
          </p>
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/app">Brands &amp; runs</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/app/fixes">Fix tracker</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
