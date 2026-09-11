// The pure Sentry helpers: sampling rate + PII scrub.
import { describe, expect, it } from "vitest";
import { scrubEvent, scrubString, tracesSampleRate } from "./sentry-scrub";

describe("tracesSampleRate", () => {
  it("uses a valid explicit rate", () => {
    expect(tracesSampleRate({ SENTRY_TRACES_SAMPLE_RATE: "0.5" })).toBe(0.5);
    expect(tracesSampleRate({ SENTRY_TRACES_SAMPLE_RATE: "0" })).toBe(0);
    expect(tracesSampleRate({ SENTRY_TRACES_SAMPLE_RATE: "1" })).toBe(1);
  });
  it("defaults to 0.2 in production, 0 elsewhere", () => {
    expect(tracesSampleRate({ VERCEL_ENV: "production" })).toBe(0.2);
    expect(tracesSampleRate({})).toBe(0);
  });
  it("ignores an out-of-range / garbage rate", () => {
    expect(tracesSampleRate({ SENTRY_TRACES_SAMPLE_RATE: "5", VERCEL_ENV: "production" })).toBe(0.2);
    expect(tracesSampleRate({ SENTRY_TRACES_SAMPLE_RATE: "abc" })).toBe(0);
  });
});

describe("scrubString", () => {
  it("redacts email addresses", () => {
    expect(scrubString("failed for jane.doe+test@acme.co here")).toBe("failed for [email] here");
  });
  it("redacts URLs (host/domain included)", () => {
    expect(scrubString("fetch https://acme.example.com/path?x=1 failed")).toBe(
      "fetch [url] failed",
    );
  });
  it("leaves clean strings untouched", () => {
    expect(scrubString("run abc123 failed at judge step")).toBe("run abc123 failed at judge step");
  });
});

describe("scrubEvent", () => {
  it("scrubs message and exception values", () => {
    const out = scrubEvent({
      message: "user a@b.com hit https://x.io/y",
      exception: { values: [{ value: "brand domain acme.com at https://acme.com" }] },
    });
    expect(out.message).toBe("user [email] hit [url]");
    expect(out.exception?.values?.[0].value).toBe("brand domain acme.com at [url]");
  });

  it("tolerates a bare event", () => {
    expect(scrubEvent({})).toEqual({});
  });
});
