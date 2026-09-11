// Social-share card (og:image) — shared links carried NO image before
// (2026-07-05 self-audit). Generated at the edge; brand tokens inline.
import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt =
  "Saylent - the open-source audit of what AI assistants say about your brand, with the receipts";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          backgroundColor: "#14212b",
          color: "#f7f5f0",
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: "#c8551b",
            }}
          />
          <div style={{ fontSize: 34, letterSpacing: 1 }}>Saylent</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 72, lineHeight: 1.1, maxWidth: 980 }}>
            AI is answering your buyers. Are you in the answer?
          </div>
          <div style={{ fontSize: 28, color: "#9fb0bb" }}>
            The open-source audit of what AI assistants say about your brand, with the
            receipts.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
