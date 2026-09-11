"use client";
// THE REPORT ACTION ROW — one row, both layers.
//
// A usability review found two things wrong with the old arrangement, and they share a
// cause: the row lived inside <Dossier> (packages/report), so
//   • the Brief ("The summary"), which is the layer a reader lands on, had no
//     back link, no share, no export and no print at all (#5); and
//   • at 390px the row could not wrap, so the page itself scrolled sideways
//     (scrollWidth 510 on a 390 viewport) and "Print / save as PDF" was cut off
//     the right edge (#6).
// It now lives here, above the view switch, and renders identically for both
// layers. The dossier's own owner row is hidden by report-chrome.module.css —
// see the note there for the one-line change in packages/report that replaces
// the CSS.
//
// SHARING IS A PUBLICATION EVENT (#1). "Share report" used to mint a public
// token on the first click, with no dialog and no warning: one stray click put a
// named brand's whole competitive dossier — every raw engine answer, every
// rival, every citation — on the open internet. It now opens a confirmation that
// says plainly what becomes public, and only the second click mints the token.
// The API refuses an un-confirmed enable as well, so the guarantee is not the
// button's alone (src/app/api/runs/[id]/share/route.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@saylent/report/ui/button";
import { PendingLink } from "@/components/pending-link";

type Phase = "idle" | "busy" | "copied";

/** POST the share endpoint. `confirm` is required by the route for "enable". */
async function callShare(
  runId: string,
  action: "enable" | "revoke",
): Promise<{ ok: boolean; token: string | null; error?: string }> {
  const res = await fetch(`/api/runs/${runId}/share`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(action === "enable" ? { action, confirm: true } : { action }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    shareToken?: string | null;
    error?: string;
  };
  if (!res.ok) return { ok: false, token: null, error: data.error };
  return { ok: true, token: data.shareToken ?? null };
}

/** The confirmation. A native <dialog> in modal mode: focus trap, Esc-to-close
 *  and inertness of the page behind it are the platform's, not ours. */
function ShareConfirmDialog({
  open,
  brandName,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  brandName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="share-confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClose={onCancel}
      className="w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-card p-0 text-ink backdrop:bg-black/50 open:block"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id="share-confirm-title" className="font-display text-xl text-ink">
          Publish this report to a public link?
        </h2>
        <ul className="flex list-none flex-col gap-2 text-sm text-wire">
          <li>
            <span className="text-ink">The whole report for {brandName || "this brand"}</span>{" "}
            becomes readable — every engine answer, every rival named, every citation and every
            fix.
          </li>
          <li>
            <span className="text-ink">Anyone with the link can read it.</span> There is no
            sign-in and no password on a share link.
          </li>
          <li>
            <span className="text-ink">Unlisted, not private.</span> The page is marked{" "}
            <span className="font-mono text-xs">noindex</span> so search engines skip it, but the
            link works for whoever it reaches.
          </li>
          <li>
            <span className="text-ink">You can revoke it here at any time.</span> Revoking kills
            the link immediately; anyone who already saved a copy still has their copy.
          </li>
        </ul>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? "Creating…" : "Create public link"}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <span className="text-xs text-wire">Cancel changes nothing.</span>
        </div>
      </div>
    </dialog>
  );
}

function ShareControl({
  runId,
  brandName,
  initialToken,
}: {
  runId: string;
  brandName: string;
  initialToken: string | null;
}) {
  const [token, setToken] = useState(initialToken);
  const [phase, setPhase] = useState<Phase>("idle");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = useCallback(async (t: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}/share/${t}`).catch(() => {});
    setPhase("copied");
    setTimeout(() => setPhase("idle"), 2500);
  }, []);

  async function create() {
    setPhase("busy");
    setError(null);
    const res = await callShare(runId, "enable");
    if (!res.ok || !res.token) {
      setPhase("idle");
      setError(res.error ?? "Could not create the link. Try again.");
      return;
    }
    setConfirming(false);
    setToken(res.token);
    await copy(res.token);
  }

  async function revoke() {
    setPhase("busy");
    setError(null);
    const res = await callShare(runId, "revoke");
    setPhase("idle");
    if (!res.ok) {
      setError(res.error ?? "Could not revoke the link. Try again.");
      return;
    }
    setToken(null);
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      {token ? (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={phase === "busy"}
            onClick={() => copy(token)}
          >
            {phase === "copied" ? "Link copied ✓" : "Copy public link"}
          </Button>
          <button
            type="button"
            className="cursor-pointer text-xs text-wire underline"
            disabled={phase === "busy"}
            onClick={revoke}
          >
            revoke
          </button>
        </>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={phase === "busy"}
          onClick={() => setConfirming(true)}
        >
          Share report
        </Button>
      )}
      {error && (
        <span role="alert" className="text-xs text-pill-dismissed">
          {error}
        </span>
      )}
      <ShareConfirmDialog
        open={confirming}
        brandName={brandName}
        busy={phase === "busy"}
        onCancel={() => {
          if (phase === "busy") return;
          setConfirming(false);
          setError(null);
        }}
        onConfirm={create}
      />
    </span>
  );
}

export function ReportActionRow({
  runId,
  brandName,
  shareToken,
}: {
  runId: string;
  brandName: string;
  shareToken: string | null;
}) {
  return (
    // flex-wrap + w-full back link below sm: the row is allowed to become two
    // rows on a phone rather than widening the document (#6).
    <div className="mx-auto mb-4 flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 print:hidden">
      <PendingLink href="/app" className="text-xs text-wire underline">
        ← Brands &amp; runs
      </PendingLink>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:ml-auto">
        <ShareControl runId={runId} brandName={brandName} initialToken={shareToken} />
        <a
          href={`/api/runs/${runId}/export?format=csv`}
          className="font-mono text-xs text-wire underline hover:text-ink"
        >
          CSV
        </a>
        <a
          href={`/api/runs/${runId}/export?format=json`}
          className="font-mono text-xs text-wire underline hover:text-ink"
        >
          JSON
        </a>
        <button
          type="button"
          onClick={() => window.print()}
          className="font-mono text-xs text-wire underline hover:text-ink"
        >
          Print / save as PDF
        </button>
      </div>
    </div>
  );
}
