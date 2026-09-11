"use client";
// /app CTA logic — buttons call /api/runs; a 409's `reason`
// is rendered VERBATIM (it's written in user language by createRun).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@saylent/report/ui/button";

// A rejection that points the user at their operator is a deployment limit —
// the operator has to raise it, a retry will not. (createRun reason strings,
// src/lib/runs.ts)
const isOperatorLimit = (reason: string) => reason.toLowerCase().includes("ask your operator");

export function RunCta({
  brandId,
  state,
  activeRunId,
}: {
  brandId: string;
  state: "none" | "running" | "audit-done";
  activeRunId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  // "Confirm your audit": a brand with NO frozen set (never audited)
  // routes through the confirm page so the user sees + aims the 23 questions before
  // the audit is spent. Brands WITH a frozen set (audit-done → re-runs/verifies) skip
  // it — the set is frozen, so there's nothing to aim — and POST directly below.
  function goConfirm() {
    setBusy(true);
    router.push(`/app/brand/${brandId}/confirm`);
  }

  async function start(kind: "audit" | "verify") {
    setBusy(true);
    setReason(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brandId, kind }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push(`/app/run/${data.runId}`);
        return;
      }
      setReason(data.reason ?? "Could not start the run.");
    } catch {
      // network/parse failure — never leave the button stuck on "Starting…"
      setReason("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {state === "running" ? (
          <Button onClick={() => router.push(`/app/run/${activeRunId}`)}>View progress</Button>
        ) : state === "audit-done" ? (
          <>
            <Button onClick={() => start("verify")} disabled={busy}>
              {busy ? "Starting…" : "Run verify"}
            </Button>
            <Button variant="outline" onClick={() => start("audit")} disabled={busy}>
              Run new audit
            </Button>
          </>
        ) : (
          <Button onClick={goConfirm} disabled={busy}>
            {busy ? "Opening…" : "Run your audit"}
          </Button>
        )}
      </div>
      {reason && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-wire">{reason}</p>
          {isOperatorLimit(reason) && (
            <Button asChild size="sm">
              <Link href="/app/settings/limits">Check your limits</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
