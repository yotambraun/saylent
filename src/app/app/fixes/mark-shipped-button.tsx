"use client";
// Same action as the dossier's Mark-as-shipped (one source of truth:
// fixes.published_at via markFixShipped) — also revalidates this page.
import { useState, useTransition } from "react";
import { markFixShipped } from "../run/[id]/actions";
import { Button } from "@saylent/report/ui/button";

export function MarkShippedButton({ fixId, runId }: { fixId: string; runId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await markFixShipped(fixId, runId, "/app/fixes");
            if (!res.ok) setError(res.error);
          })
        }
      >
        {pending ? "Saving…" : "Mark as shipped"}
      </Button>
      {error && <span className="font-mono text-[10px] text-pill-dismissed">{error}</span>}
    </span>
  );
}
