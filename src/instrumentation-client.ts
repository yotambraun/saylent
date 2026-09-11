// Sentry CLIENT init. Next 16 file convention: the client
// runtime instrumentation lives in `instrumentation-client.ts` (the old
// `sentry.client.config.ts` name no longer works under Turbopack — @sentry/nextjs
// warns about it explicitly). INERT without SENTRY_DSN: the guard skips init, so
// no client loads in the browser and every capture is a clean no-op.
//
// Session replay is OFF at launch (the dashboard has no complex
// UI worth replay quota) — we simply never enable the replay integration.
import * as Sentry from "@sentry/nextjs";
import { scrubEvent, tracesSampleRate } from "@/lib/sentry-scrub";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: tracesSampleRate(),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
  });
}

// Navigation instrumentation hook the SDK asks for (a no-op when Sentry is
// uninitialized/DSN-less — silences the dev "ACTION REQUIRED" warning).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
