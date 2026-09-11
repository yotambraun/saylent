// Sentry EDGE runtime init (middleware / edge routes). Loaded
// by src/instrumentation.ts register() only when NEXT_RUNTIME === "edge". INERT
// without SENTRY_DSN: the guard skips init, so every capture is a clean no-op.
import * as Sentry from "@sentry/nextjs";
import { scrubEvent, tracesSampleRate } from "@/lib/sentry-scrub";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: tracesSampleRate(),
    beforeSend: (event) => scrubEvent(event),
  });
}
