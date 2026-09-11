"use client";
// The re-measure moment: ONE card shown when a brand has shipped fixes that no
// verify has re-measured yet. Nothing gates it — the button triggers the same
// run-creation path (POST /api/runs) that run-cta.tsx uses, so createRun stays
// the single authority on whether a run may start, and its refusal (a throttle,
// the spend cap) is rendered verbatim.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@saylent/report/ui/button";

export function VerifyPromptCard({
  brandId,
  brandName,
  shippedCount,
  baselineRunId,
}: {
  brandId: string;
  brandName: string;
  shippedCount: number;
  /** the baseline audit's run id — the report these fixes came from */
  baselineRunId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  const shipped = `${shippedCount} fix${shippedCount === 1 ? "" : "es"} shipped`;

  async function runVerify() {
    setBusy(true);
    setReason(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brandId, kind: "verify" }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push(`/app/run/${data.runId}`);
        return;
      }
      // createRun's reason is written in user language — render it verbatim.
      setReason(data.reason ?? "Could not start the verify run.");
    } catch {
      setReason("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-signal/40 bg-signal/5 p-5">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[10px] uppercase tracking-widest text-signal">
          Re-measure {brandName}
        </p>
        <p className="max-w-3xl text-sm leading-relaxed text-ink/90">
          {shipped} for {brandName}. A verify run re-asks the <strong>same frozen questions</strong>{" "}
          and shows the real movement, fix by fix.
        </p>
      </div>

      <div className="flex flex-col items-start gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={runVerify} disabled={busy} size="sm">
            {busy ? "Starting…" : "Run verify"}
          </Button>
          {baselineRunId && (
            <Link href={`/app/run/${baselineRunId}`} className="text-sm text-wire underline hover:text-ink">
              See the full report
            </Link>
          )}
        </div>
        {reason && (
          <p role="alert" className="text-sm text-wire">
            {reason}
          </p>
        )}
        <p className="text-xs text-wire">
          Give the engines a few days to recrawl after a fix ships — a re-measure taken the same
          hour usually shows nothing.
        </p>
      </div>
    </div>
  );
}
