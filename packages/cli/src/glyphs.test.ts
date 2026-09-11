// The encoding heuristic behind every glyph the CLI prints. The rule the
// tests pin: ASCII only on POSITIVE evidence that the stream is not UTF-8, so
// an ordinary terminal never loses the nice glyphs.
import { describe, expect, it } from "vitest";
import { glyph, resetGlyphSupport, stdoutSupportsUnicode, withGlyphs } from "./glyphs";

type Env = Record<string, string | undefined>;
const posix = (env: Env) => stdoutSupportsUnicode(env, "linux", undefined);
const win = (env: Env) => stdoutSupportsUnicode(env, "win32", undefined);

describe("stdoutSupportsUnicode", () => {
  it("honours the explicit escape hatches first", () => {
    expect(posix({ SAYLENT_ASCII: "1", LANG: "en_US.UTF-8" })).toBe(false);
    expect(posix({ SAYLENT_UNICODE: "1", LANG: "C" })).toBe(true);
  });

  it("reads the locale as the declaration of the stream's encoding", () => {
    expect(posix({ LANG: "C.UTF-8" })).toBe(true);
    expect(posix({ LANG: "en_US.utf8" })).toBe(true);
    expect(posix({ LC_ALL: "en_US.UTF-8", LANG: "C" })).toBe(true); // LC_ALL wins
    expect(posix({ LANG: "C" })).toBe(false);
    expect(posix({ LANG: "en_US.ISO-8859-1" })).toBe(false);
  });

  it("does not guess ASCII from a missing locale, and TERM=dumb is not a signal", () => {
    expect(posix({})).toBe(true);
    expect(posix({ TERM: "dumb" })).toBe(true); // no colours != no UTF-8
    expect(posix({ TERM: "linux" })).toBe(false); // a bare VT really is limited
  });

  it("treats a stdout pinned to a non-UTF-8 encoding as ASCII", () => {
    expect(stdoutSupportsUnicode({ LANG: "en_US.UTF-8" }, "linux", "latin1")).toBe(false);
    expect(stdoutSupportsUnicode({ LANG: "en_US.UTF-8" }, "linux", "utf8")).toBe(true);
  });

  it("on Windows, only the terminals that run code page 65001 get glyphs", () => {
    expect(win({ WT_SESSION: "abc" })).toBe(true);
    expect(win({ TERM_PROGRAM: "vscode" })).toBe(true);
    expect(win({ CI: "true" })).toBe(true);
    expect(win({})).toBe(false); // plain conhost
  });
});

describe("glyph", () => {
  it("prints the glyph when the stream can carry it, ASCII when it cannot", () => {
    resetGlyphSupport(true);
    expect(glyph("check")).toBe("✓");
    expect(withGlyphs("$0.40–$0.70 · ok ✓")).toBe("$0.40–$0.70 · ok ✓");

    resetGlyphSupport(false);
    expect(glyph("check")).toBe("+");
    expect(glyph("cross")).toBe("x");
    expect(withGlyphs("$0.40–$0.70 · ok ✓")).toBe("$0.40-$0.70 - ok +");

    resetGlyphSupport();
  });
});
