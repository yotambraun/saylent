"use client";
// A minimal, COOKIE-FREE analytics init. Mounted in
// the app layout, it seeds the sessionStorage anon id once so any client event
// fired later in the session (via trackClient) shares one anonymous identity —
// WITHOUT setting a tracking cookie (so no consent banner is needed). It
// renders nothing and fires no event on its own: the event taxonomy is a fixed
// enum, and page views are deliberately not in it.
import { useEffect } from "react";
import { getAnonId } from "@/lib/analytics-client";

export function AnalyticsProvider() {
  useEffect(() => {
    getAnonId();
  }, []);
  return null;
}
