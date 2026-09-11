// The PURE half of the Sentry wiring: sampling rate + the
// beforeSend PII scrub. No @sentry/nextjs import, so it is unit-testable and safe
// to pull into the config files without dragging the SDK into a test run.

/** Production trace sampling: SENTRY_TRACES_SAMPLE_RATE if set+valid, else 0.2 in
 *  production / 0 elsewhere (0.2 stays inside the free tier at
 *  launch traffic; errors are captured regardless of trace sampling). */
export function tracesSampleRate(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.SENTRY_TRACES_SAMPLE_RATE;
  if (raw !== undefined && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  }
  return env.VERCEL_ENV === "production" ? 0.2 : 0;
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const URL_RE = /\bhttps?:\/\/[^\s"'<>)]+/gi;

/** Redact obvious PII (email addresses, URLs incl. their host/domain) from a free
 *  string. Pure; used by beforeSend and unit-tested directly. */
export function scrubString(s: string): string {
  return s.replace(EMAIL_RE, "[email]").replace(URL_RE, "[url]");
}

/** Minimal shape of the fields we scrub on a Sentry event. */
export interface ScrubbableEvent {
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
}

/** beforeSend hook body: walk the message + exception values through scrubString.
 *  Mutates and returns the event (Sentry's beforeSend contract). */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (typeof event.message === "string") event.message = scrubString(event.message);
  const values = event.exception?.values;
  if (values) {
    for (const v of values) {
      if (typeof v.value === "string") v.value = scrubString(v.value);
    }
  }
  return event;
}
