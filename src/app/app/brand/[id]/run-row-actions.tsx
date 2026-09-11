"use client";
// Per-run hygiene control on the brand Movement page's run history (migration
// 0038). Hiding a run drops it from dashboards/lists/cohorts but keeps it
// reachable by URL; unhide brings it back. Calls the run-owned server actions (RLS
// enforces ownership) and refreshes the server tree so the list re-partitions.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { hideRun, unhideRun } from "../../run/[id]/actions";

export function RunRowActions({ runId, hidden }: { runId: string; hidden: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(false);
          const res = await (hidden ? unhideRun(runId) : hideRun(runId));
          if (res.ok) router.refresh();
          else {
            setErr(true);
            setBusy(false);
          }
        }}
        className="font-mono text-[11px] text-wire underline underline-offset-2 hover:text-ink disabled:opacity-50"
      >
        {busy ? "…" : hidden ? "Unhide" : "Hide"}
      </button>
      {err && <span className="font-mono text-[10px] text-pill-dismissed">failed</span>}
    </span>
  );
}
