// Next 16 instrumentation entry. register() runs ONCE per
// server instance and loads the matching Sentry runtime config; onRequestError
// forwards server errors to Sentry. All INERT without SENTRY_DSN (the config files
// skip init and captureRequestError is a no-op with no active client).
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
