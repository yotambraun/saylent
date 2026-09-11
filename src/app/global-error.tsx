"use client";
// Next 16 global-error: the last-resort boundary. It REPLACES the root layout
// when the root layout itself throws, so it must render its own <html>/<body>
// and style itself inline, so it still reads calmly even if the stylesheet failed
// to load. Its only imports are the two that cannot fail on their own: the branding
// constants and the Sentry reporter (inert without a DSN).
// (docs: node_modules/next/.../file-conventions/error.md)
import { useEffect } from "react";
import { captureError } from "@/lib/sentry";
import { APP_NAME, contactPhrase, PROJECT_ISSUES_URL } from "@/lib/branding";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Forward to Sentry (a clean no-op when no DSN is configured), tagged with
    // the boundary that caught it and the digest the reader is shown, so a
    // support ticket quoting that reference lands on the right event.
    captureError(error, { boundary: "global-error", digest: error.digest });
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          background: "#faf8f4",
          color: "#1a1a1a",
          fontFamily:
            "ui-serif, Georgia, 'Times New Roman', serif",
        }}
      >
        <div style={{ maxWidth: "28rem", textAlign: "left" }}>
          <p
            style={{
              margin: 0,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "0.7rem",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "#8a8578",
            }}
          >
            {APP_NAME}
          </p>
          <h1
            style={{
              margin: "0.75rem 0 0",
              fontSize: "1.5rem",
              fontWeight: 600,
              lineHeight: 1.2,
            }}
          >
            Something went wrong on our side
          </h1>
          <p
            style={{
              margin: "0.75rem 0 0",
              fontSize: "0.95rem",
              lineHeight: 1.5,
              color: "#4a4740",
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
            }}
          >
            Nothing you did. The page couldn&apos;t load. Your data and runs are safe.
            Try again, and if it keeps happening, tell {contactPhrase()}
            {" — or, if you think it is a bug in the software itself, open an issue at "}
            <a href={PROJECT_ISSUES_URL} style={{ color: "#4a4740" }}>
              github.com/yotambraun/saylent/issues
            </a>
            .
          </p>
          <div style={{ marginTop: "1.25rem", display: "flex", gap: "0.75rem" }}>
            <button
              onClick={() => reset()}
              style={{
                cursor: "pointer",
                borderRadius: "0.375rem",
                border: "none",
                background: "#1a1a1a",
                color: "#faf8f4",
                padding: "0.5rem 1rem",
                fontSize: "0.9rem",
                fontFamily: "ui-sans-serif, system-ui, sans-serif",
              }}
            >
              Try again
            </button>
            {/* Plain <a> on purpose: global-error replaces a broken root layout,
                so a full-document reload is safer than client-side routing. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                borderRadius: "0.375rem",
                border: "1px solid #d8d3c8",
                color: "#1a1a1a",
                textDecoration: "none",
                padding: "0.5rem 1rem",
                fontSize: "0.9rem",
                fontFamily: "ui-sans-serif, system-ui, sans-serif",
              }}
            >
              Back to the homepage
            </a>
          </div>
          {error.digest && (
            <p
              style={{
                marginTop: "1.25rem",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.75rem",
                color: "#8a8578",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
