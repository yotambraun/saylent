// THE ONE PREVIEW PIPELINE — unit contract for src/lib/strip-md.ts. Every
// display/preview string in the report flows through `previewText`; these tests
// pin the guarantees the composers and `preview-invariants.test.ts` rely on:
// markdown never leaks, citation brackets go, whitespace is normalized, and an
// upstream mid-word cut is healed. Receipts (raw_text) never pass through here.
import { describe, expect, it } from "vitest";
import {
  previewText,
  sliceCodePoints,
  stripMarkdownForPreview,
  tidyPreviewQuote,
  trimEdgeFragments,
} from "./strip-md";

describe("stripMarkdownForPreview", () => {
  it("unwraps paired emphasis (**bold**, *em*)", () => {
    expect(stripMarkdownForPreview("**Best Overall** pick")).toBe("Best Overall pick");
    expect(stripMarkdownForPreview("an *italic* word.")).toBe("an italic word.");
  });

  it("removes ORPHAN emphasis markers a mid-word cut leaves behind", () => {
    // a truncated excerpt strands an unpaired ** / * the pair rules can't catch
    expect(stripMarkdownForPreview("uses the **mid")).toBe("uses the mid");
    expect(stripMarkdownForPreview("rate* and fees")).toBe("rate and fees");
    expect(stripMarkdownForPreview("a *** run")).toBe("a run");
    expect(stripMarkdownForPreview("**")).toBe("");
  });

  it("strips single and chained [n] citation brackets", () => {
    expect(stripMarkdownForPreview("cheap[1] and fast[2][3].")).toBe("cheap and fast.");
    expect(stripMarkdownForPreview("[12][7]edge")).toBe("edge");
  });

  it("strips ATX headings and inline code", () => {
    expect(stripMarkdownForPreview("## Heading here")).toBe("Heading here");
    expect(stripMarkdownForPreview("run `npm test` now")).toBe("run npm test now");
  });

  it("collapses runs of 2+ whitespace but keeps single spaces", () => {
    expect(stripMarkdownForPreview("a    b   c")).toBe("a b c");
  });

  it("is idempotent", () => {
    const s = "**bold**[1] and *em* `code` ## no";
    const once = stripMarkdownForPreview(s);
    expect(stripMarkdownForPreview(once)).toBe(once);
  });
});

describe("previewText (canonical entry)", () => {
  it("default = strip + collapse ALL whitespace (incl. newlines) + trim", () => {
    expect(previewText("  **hi**\n\tthere  ")).toBe("hi there");
    expect(previewText("[4] cited\nline")).toBe("cited line");
  });

  it("tolerates null/undefined", () => {
    expect(previewText(undefined as unknown as string)).toBe("");
    expect(previewText(null as unknown as string)).toBe("");
  });

  it("default mode is idempotent", () => {
    const once = previewText("**a**  b\n[2] c");
    expect(previewText(once)).toBe(once);
  });

  it("{ tail } folds a SHORT trailing cut fragment into the ellipsis", () => {
    expect(previewText("uses the mid-market rate mid…", { tail: true })).toBe(
      "uses the mid-market rate…",
    );
  });

  it("{ tail } normalizes a lone ASCII '...' tail to the '…' glyph (no preceding fragment)", () => {
    // single token, no space before the dots ⇒ only the glyph-normalize fires
    expect(previewText("rates...", { tail: true })).toBe("rates…");
  });

  it("{ tail } treats a SHORT word before a trailing '...' as a cut fragment (heuristic)", () => {
    // "rate" (≤12 chars) sitting before the ellipsis is folded — the documented
    // aggressive tail heuristic; only fires on strings already ending in an ellipsis
    expect(previewText("all transfers use the mid-market rate...", { tail: true })).toBe(
      "all transfers use the mid-market…",
    );
  });

  it("{ tail } leaves a LONG (>12-char) final token alone (probably a real word)", () => {
    // "sustainability" is 14 chars — not a likely mid-word fragment, keep it
    const s = "we value sustainability…";
    expect(previewText(s, { tail: true })).toBe(s);
  });

  it("{ edges } drops one partial token at each ellipsis-wrapped edge", () => {
    expect(previewText("ansfer service for peop", { edges: true })).toBe("service for");
  });

  it("{ edges } also strips markdown from the source first", () => {
    expect(previewText("orst **money** transfer servic", { edges: true })).toBe("money transfer");
  });
});

describe("tidyPreviewQuote (kept export, quote-excerpt tail heuristic)", () => {
  it("strips markdown then folds the trailing fragment", () => {
    expect(tidyPreviewQuote("**uses** the mid…")).toBe("uses the…");
  });

  it("normalizes a lone ASCII ellipsis tail (single token, no fragment)", () => {
    expect(tidyPreviewQuote("rates...")).toBe("rates…");
  });

  it("leaves a clean sentence untouched", () => {
    expect(tidyPreviewQuote("great exchange rates.")).toBe("great exchange rates.");
  });
});

describe("trimEdgeFragments (page-excerpt edge tidy, no markdown strip)", () => {
  it("drops a leading mid-sentence token (lowercase start)", () => {
    // terminal '.' isolates the leading rule from the trailing rule
    expect(trimEdgeFragments("ansfer service for people.")).toBe("service for people.");
  });

  it("drops a trailing token when there is no sentence-final punctuation", () => {
    expect(trimEdgeFragments("The best money transfer servic")).toBe("The best money transfer");
  });

  it("keeps a capitalized, terminally-punctuated excerpt intact", () => {
    expect(trimEdgeFragments("The best rate wins.")).toBe("The best rate wins.");
  });

  it("does NOT strip markdown (that is the caller's pipeline concern)", () => {
    // starts uppercase + ends with '.', so only markdown would change it — and it must not
    expect(trimEdgeFragments("**Bold** claim.")).toBe("**Bold** claim.");
  });
});

describe("sliceCodePoints (surrogate-pair-safe length cap)", () => {
  it("never splits a surrogate pair (an emoji) mid-character", () => {
    const s = "abc\u{1F6A8}def"; // 🚨 is one code point, two UTF-16 code units
    // a raw .slice(0, 4) would cut mid-emoji, leaving a lone high surrogate
    const cut = sliceCodePoints(s, 4);
    expect(cut).toBe("abc\u{1F6A8}");
    // every UTF-16 code unit in the result is valid on its own — no lone surrogate
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(cut)).toBe(false);
    expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(cut)).toBe(false);
  });

  it("matches a plain .slice for BMP-only text", () => {
    expect(sliceCodePoints("hello world", 5)).toBe("hello");
  });

  it("is a no-op when the cap exceeds the string length", () => {
    expect(sliceCodePoints("short", 100)).toBe("short");
  });
});
