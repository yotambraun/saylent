// Server-side, COOKIE-FREE product analytics.
//
// track() writes one analytics_events row through the service-role client. It is
// the ONLY write path. Two hard rules:
//   1. It NEVER throws. A tracking failure (DB blip, bad shape) must never break
//      the user flow it is observing — every call is wrapped and swallowed.
//   2. It writes to OUR DB only — no third-party tag, no tracking cookie. Authed
//      events are keyed by user_id (from the session); anonymous events carry an
//      anon_id the client keeps in sessionStorage (not a cookie). This is why
//      Saylent needs no cookie-consent banner.
//
// The event name is a FIXED enum (below). Anything off the list is dropped — this
// keeps the funnel taxonomy stable and lets /api/track validate client input.
import { createAdminClient } from "./supabase/admin";

// The activation taxonomy. receipt_opened is "the
// aha" — the moment a buyer first sees a dossier they can trust.
// `checkout_started` and `purchase` were dropped when billing was removed: they
// could never fire again, and the admin console printed them to the operator as
// if the product still sold something. An old row keeps its name
// in the DB; it simply is not a name this app can write any more.
export const ANALYTICS_EVENTS = [
  "signup",
  "onboarding_started",
  "brand_created",
  "first_audit_started",
  "receipt_opened",
  "artifact_copied",
  "fix_shipped",
  "verify_run",
  "share_created",
  // THE BRIEF — the answer-first lead layer's engagement funnel:
  // card opened → receipt opened (the "aha" from the Brief) → jumped to dossier.
  "brief_card_opened",
  "brief_receipt_opened",
  "brief_to_dossier",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

const EVENT_SET: ReadonlySet<string> = new Set(ANALYTICS_EVENTS);

/** True iff `x` is one of the fixed analytics event names. The type guard the
 *  /api/track endpoint uses to reject anything off the taxonomy. */
export function isAnalyticsEvent(x: unknown): x is AnalyticsEvent {
  return typeof x === "string" && EVENT_SET.has(x);
}

export interface TrackContext {
  userId?: string | null;
  anonId?: string | null;
  props?: Record<string, unknown> | null;
}

/** Record one product-analytics event. Fire-and-forget: awaiting is optional and
 *  a failure is swallowed (returns false) so the observed flow never breaks. An
 *  unknown event name is a no-op — the taxonomy stays clean. */
export async function track(event: AnalyticsEvent, ctx: TrackContext = {}): Promise<boolean> {
  try {
    if (!isAnalyticsEvent(event)) return false;
    const admin = createAdminClient();
    const { error } = await admin.from("analytics_events").insert({
      event,
      user_id: ctx.userId ?? null,
      anon_id: ctx.anonId ?? null,
      props: ctx.props ?? null,
    });
    return !error;
  } catch {
    return false;
  }
}
