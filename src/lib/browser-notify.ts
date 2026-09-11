// The Web Notification API, fully feature-detected so it is a
// no-op (never throws) on browsers without it. Client-only: every function guards
// on `window`/`Notification`. We NEVER request permission on load — only from an
// explicit user click (see run-view.tsx). Firing is gated on document.hidden so a
// visible tab is served by the pill + title signal instead.

const DISMISSED_KEY = "saylent:notify-dismissed";

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission;
}

/** Should we offer the quiet "Notify me" affordance? Only when supported, not yet
 * decided, and the user hasn't previously been denied (persisted flag). */
export function canOfferNotify(): boolean {
  if (!notificationsSupported()) return false;
  if (Notification.permission !== "default") return false;
  try {
    return window.localStorage.getItem(DISMISSED_KEY) !== "1";
  } catch {
    return true; // storage blocked → still allow the offer
  }
}

/** Requests permission from a user gesture. On denial, persists a flag so we
 * never ask again. Returns the resulting permission (or "unsupported"). */
export async function requestNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  if (!notificationsSupported()) return "unsupported";
  let result: NotificationPermission;
  try {
    result = await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
  if (result === "denied") {
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* storage blocked — the "denied" permission itself still hides the offer */
    }
  }
  return result;
}

/** Fires a notification IFF permission is granted AND the tab is hidden. Clicking
 * it focuses the tab and navigates to href. Safe no-op otherwise. */
export function fireNotificationIfHidden(opts: {
  title: string;
  body?: string;
  icon?: string;
  href: string;
}): void {
  if (!notificationsSupported()) return;
  if (Notification.permission !== "granted") return;
  if (typeof document === "undefined" || !document.hidden) return;
  try {
    const n = new Notification(opts.title, { body: opts.body, icon: opts.icon });
    n.onclick = () => {
      window.focus();
      window.location.assign(opts.href);
      n.close();
    };
  } catch {
    /* some browsers throw on the constructor (e.g. Android requires a SW) — ignore */
  }
}
