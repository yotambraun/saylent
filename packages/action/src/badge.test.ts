import { describe, expect, it } from "vitest";
import { renderBadgeSvg } from "./badge";

describe("renderBadgeSvg", () => {
  it("carries the label, the status word, and valid SVG structure for pass/warn/fail", () => {
    for (const status of ["pass", "warn", "fail"] as const) {
      const svg = renderBadgeSvg(status);
      expect(svg).toContain("<svg");
      expect(svg).toContain("</svg>");
      expect(svg).toContain("AI access");
      expect(svg).toContain(`>${status}<`);
      expect(svg).toContain(`aria-label="AI access: ${status}"`);
    }
  });

  it("uses a distinct color per status", () => {
    expect(renderBadgeSvg("pass")).toContain("#2ea44f");
    expect(renderBadgeSvg("warn")).toContain("#dbab09");
    expect(renderBadgeSvg("fail")).toContain("#cf222e");
  });

  it("makes no external requests — no fetchable URL anywhere but the SVG xmlns", () => {
    // The xmlns="http://www.w3.org/2000/svg" attribute is a namespace identifier,
    // never fetched by any renderer — everything else that COULD trigger a request
    // (<image>, @import, url(http...), an http(s) href/xlink:href) must be absent.
    for (const status of ["pass", "warn", "fail"] as const) {
      const svg = renderBadgeSvg(status);
      expect(svg).not.toContain("<image");
      expect(svg).not.toContain("@import");
      expect(svg).not.toMatch(/url\(https?:/);
      expect(svg).not.toMatch(/(?:xlink:)?href=["']https?:/);
    }
  });
});
