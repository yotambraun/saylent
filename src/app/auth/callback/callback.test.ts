// The auth callback's `next` parameter is attacker-controlled.
// These cases are the reproduction: every payload below used to be pasted
// straight after `origin`, producing a redirect that leaves our domain right
// after the victim was signed in.
import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT, safeNextPath } from "./route";

describe("safeNextPath — open-redirect payloads all land on /app", () => {
  const payloads = [
    "@evil.com", // https://app.example.com@evil.com → evil.com
    "//evil.com", // protocol-relative
    "/\\evil.com", // backslash variant browsers normalize to //
    "\\\\evil.com",
    "https://evil.com",
    "http://evil.com/app",
    "//evil.com/app?next=/app",
    "javascript:alert(1)",
    "evil.com",
    "app", // relative — would resolve against /auth/callback
    "/app\nLocation: https://evil.com", // header splitting
    "/app\r\nSet-Cookie: a=b",
    "",
    "   ",
  ];

  for (const payload of payloads) {
    it(`refuses ${JSON.stringify(payload)}`, () => {
      expect(safeNextPath(payload)).toBe(DEFAULT_NEXT);
      // and the composed redirect really does stay on our origin
      expect(new URL(`https://app.example.com${safeNextPath(payload)}`).origin).toBe(
        "https://app.example.com",
      );
    });
  }

  it("defaults to /app when next is absent", () => {
    expect(safeNextPath(null)).toBe("/app");
    expect(safeNextPath(undefined)).toBe("/app");
  });

  it("keeps the real in-app destinations the product sends", () => {
    // the password-recovery hop the reset flow depends on
    expect(safeNextPath("/auth/reset/update")).toBe("/auth/reset/update");
    expect(safeNextPath("/app")).toBe("/app");
    expect(safeNextPath("/app/brand/123/questions?tab=edit")).toBe(
      "/app/brand/123/questions?tab=edit",
    );
    expect(safeNextPath("/admin/providers#keys")).toBe("/admin/providers#keys");
  });
});
