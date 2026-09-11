// The browser-side fire helper. Client components
// call trackClient() to POST an event to /api/track (server code calls track()
// in analytics.ts directly).
//
// COOKIE-FREE: the anonymous id lives in sessionStorage — NOT a cookie. It is
// never sent to the server automatically and is cleared when the tab closes, so
// it is not "tracking" in the ePrivacy sense and needs no consent banner.
// When the caller is logged in, the /api/track route keys the
// event by the session user id instead and ignores this value.
"use client";
import type { AnalyticsEvent } from "./analytics";

const ANON_KEY = "saylent_anon";

/** Stable-per-tab anonymous id from sessionStorage (created on first use). Returns
 *  null if storage is unavailable (private mode / SSR) — the event still fires,
 *  just without an anon id. */
export function getAnonId(): string | null {
  try {
    if (typeof window === "undefined") return null;
    let id = window.sessionStorage.getItem(ANON_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.sessionStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/** Fire an analytics event from the browser. Never throws and never blocks — a
 *  tracking failure must not affect the UI. */
export function trackClient(event: AnalyticsEvent, props?: Record<string, unknown>): void {
  try {
    const body = JSON.stringify({ event, anonId: getAnonId(), props });
    // keepalive lets the beacon survive a navigation away from the page.
    void fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // swallow — analytics must never break a flow.
  }
}
