// Sentry SERVER runtime init. Loaded by src/instrumentation.ts
// register() only when NEXT_RUNTIME === "nodejs". INERT without SENTRY_DSN: the
// guard skips init entirely, so no client is created and every capture is a no-op.
import * as Sentry from "@sentry/nextjs";
import { scrubEvent, tracesSampleRate } from "@/lib/sentry-scrub";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: tracesSampleRate(),
    // Session replay is a CLIENT feature; nothing to configure server-side.
    // Errors are always captured regardless of the trace sample rate.
    beforeSend: (event) => scrubEvent(event),
  });
}
