"use client";
// Tab-title + favicon signal, driven by the pill state. When a
// run is live/done AND the tab is hidden, the title becomes "▶ {stage} — Saylent"
// / "✓ Dossier ready — Saylent" and the favicon swaps to the alert variant. On
// focus / visibilitychange we ALWAYS restore the page's own title and icon. All
// DOM work is inside effects → SSR-safe.
import { useEffect, useRef } from "react";
import { tabSignalTitle, type PillState } from "@/lib/run-pill";

const ALERT_FAVICON_ID = "saylent-favicon-alert";

function setAlertFavicon(on: boolean) {
  if (typeof document === "undefined") return;
  const existing = document.getElementById(ALERT_FAVICON_ID);
  if (on) {
    if (existing) return;
    const link = document.createElement("link");
    link.id = ALERT_FAVICON_ID;
    link.rel = "icon";
    link.type = "image/svg+xml";
    // last-inserted icon link wins in modern browsers; removing it restores
    // Next's file-convention icon.svg.
    link.href = "/favicon-alert.svg";
    document.head.appendChild(link);
  } else if (existing) {
    existing.remove();
  }
}

export function useTabSignal(state: PillState) {
  // The page's own title, captured lazily the moment we first override it, so we
  // restore to whatever the current route set (not a stale value).
  const baseTitle = useRef<string | null>(null);

  const kind = state.kind;
  const stage = state.run?.stage ?? "";

  useEffect(() => {
    if (typeof document === "undefined") return;

    const signalling = kind === "running" || kind === "queued" || kind === "done";

    const restore = () => {
      if (baseTitle.current !== null) {
        document.title = baseTitle.current;
        baseTitle.current = null;
      }
      setAlertFavicon(false);
    };

    const apply = () => {
      if (signalling && document.hidden) {
        const t = tabSignalTitle(state);
        if (t) {
          if (baseTitle.current === null) baseTitle.current = document.title;
          document.title = t;
        }
        setAlertFavicon(true);
      } else {
        restore();
      }
    };

    apply();
    document.addEventListener("visibilitychange", apply);
    window.addEventListener("focus", apply);
    return () => {
      document.removeEventListener("visibilitychange", apply);
      window.removeEventListener("focus", apply);
      restore();
    };
    // re-run when the signal meaning changes (kind or the live stage string)
  }, [kind, stage, state]);
}
