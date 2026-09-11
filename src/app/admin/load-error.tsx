// The one "this list did not load" card for the operator console. An admin query
// that fails returns `{ data: null, error }`, and rendering `data ?? []` turns that
// into an empty table that reads as "nothing to action" — the most expensive lie
// this console can tell an operator. Every list branches on `error` and renders
// this instead, with the database's own message so the cause is visible.
import { Card, CardContent, CardHeader, CardTitle } from "@saylent/report/ui/card";

export function LoadError({ what, message }: { what: string; message?: string | null }) {
  return (
    <Card className="border-pill-dismissed">
      <CardHeader>
        <CardTitle className="font-display text-base">Could not load {what}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm text-wire">
        <p>
          This is a failed query, not an empty list — do not read it as &ldquo;nothing to
          action&rdquo;. Reload the page; if it keeps failing, check that the database is
          reachable on /setup.
        </p>
        {message && <p className="font-mono text-xs text-pill-dismissed">{message}</p>}
      </CardContent>
    </Card>
  );
}
