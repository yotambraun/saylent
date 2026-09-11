// Sentry reporter, inert until a DSN exists. With no DSN
// nothing initializes (see sentry.*.config.ts) and reportError is a clean no-op,
// so the build stays green and no error is emitted locally. The pure sampling +
// PII-scrub helpers live in ./sentry-scrub (unit-tested without the SDK).
import * as Sentry from "@sentry/nextjs";

export { scrubEvent, scrubString, tracesSampleRate } from "./sentry-scrub";
export type { ScrubbableEvent } from "./sentry-scrub";

/** Report an exception to Sentry with optional tags (e.g. runId, engine). Clean
 *  no-op without a DSN, and NEVER throws — observability must not break a run. */
export function reportError(
  err: unknown,
  tags?: Record<string, string | number | boolean | undefined>,
): void {
  try {
    if (!process.env.SENTRY_DSN) return;
    Sentry.captureException(err, tags ? { tags } : undefined);
  } catch {
    // swallow — a failed capture must never surface to the caller
  }
}

/** Report an exception from EITHER runtime. `reportError` gates on SENTRY_DSN,
 *  which is server-only — that variable never reaches the browser bundle, so a
 *  client component (every error.tsx boundary is one) would silently drop every
 *  capture. This one accepts the browser DSN too and is the boundaries' entry
 *  point. Same contract as reportError: clean no-op without a DSN, never throws. */
export function captureError(
  err: unknown,
  tags?: Record<string, string | number | boolean | undefined>,
): void {
  try {
    if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) return;
    Sentry.captureException(err, tags ? { tags } : undefined);
  } catch {
    // swallow — a failed capture must never surface to the caller
  }
}
