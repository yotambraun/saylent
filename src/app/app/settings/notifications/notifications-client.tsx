"use client";
// Notifications — email_reports toggle. Auto-saves on click (toggles never sit
// behind a Save button). Optimistic flip, reverts if the write fails.
import { useEffect, useState } from "react";
import {
  notificationPermission,
  requestNotificationPermission,
} from "@/lib/browser-notify";
import { cn } from "@saylent/report/utils";
import { toggleEmailReports } from "../profile-actions";

export function EmailReportsToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function flip() {
    const nextOn = !on;
    setBusy(true);
    setOn(nextOn); // optimistic
    const res = await toggleEmailReports(nextOn);
    if (!res.ok) setOn(!nextOn); // revert on failure
    setBusy(false);
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Email reports"
      disabled={busy}
      onClick={flip}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-line transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
        on ? "bg-signal" : "bg-pill-absent/40",
        "motion-reduce:transition-none",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-paper shadow transition-transform",
          on ? "translate-x-6" : "translate-x-1",
          "motion-reduce:transition-none",
        )}
      />
    </button>
  );
}

// The browser-notifications control. Permission lives in the
// browser (never our DB), so this is fully client-side and feature-detected. We
// read the state on mount to avoid an SSR/CSR mismatch; requesting only ever
// happens from this explicit click.
export function BrowserNotificationsRow() {
  const [state, setState] = useState<NotificationPermission | "unsupported" | null>(null);
  useEffect(() => {
    // permission lives in the browser — read it on mount (SSR renders null)
    const read = () => setState(notificationPermission());
    read();
  }, []);

  if (state === null) return <span className="text-sm text-wire">…</span>;
  if (state === "unsupported")
    return <span className="text-sm text-wire">Not available in this browser.</span>;
  if (state === "granted") return <span className="text-sm text-success">Enabled ✓</span>;
  if (state === "denied")
    return (
      <span className="text-sm text-wire">
        Blocked. Turn it back on in your browser&apos;s site settings.
      </span>
    );
  return (
    <button
      type="button"
      onClick={async () => setState(await requestNotificationPermission())}
      className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Enable
    </button>
  );
}
