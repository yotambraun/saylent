import { describe, expect, it } from "vitest";
import { parseInline } from "./inline-markdown";

describe("parseInline", () => {
  it("renders **bold** as bold segments and strips the markers", () => {
    const segs = parseInline("Pick **Trackflow** for speed.");
    expect(segs).toEqual([
      { text: "Pick ", bold: false },
      { text: "Trackflow", bold: true },
      { text: " for speed.", bold: false },
    ]);
    expect(segs.map((s) => s.text).join("")).not.toContain("*");
  });

  it("handles multiple bold spans", () => {
    const segs = parseInline("**A** and **B**");
    expect(segs.filter((s) => s.bold).map((s) => s.text)).toEqual(["A", "B"]);
  });

  it("reduces a markdown link to its label", () => {
    const segs = parseInline("see Trackflow ([trackflow.example](https://trackflow.example/x?utm=1)).");
    const joined = segs.map((s) => s.text).join("");
    expect(joined).toBe("see Trackflow (trackflow.example).");
    expect(joined).not.toContain("http");
  });

  it("combines links and bold", () => {
    const segs = parseInline("**Trackflow** ([atlassian.com](https://a.com))");
    expect(segs.some((s) => s.bold && s.text === "Trackflow")).toBe(true);
    expect(segs.map((s) => s.text).join("")).toBe("Trackflow (atlassian.com)");
  });

  it("passes plain text through as a single non-bold segment", () => {
    expect(parseInline("no markup here")).toEqual([{ text: "no markup here", bold: false }]);
  });

  it("leaves an unmatched stray marker alone rather than corrupting", () => {
    const segs = parseInline("a ** stray");
    expect(segs.map((s) => s.text).join("")).toBe("a ** stray");
  });
});
