// ONE place every non-ASCII glyph the CLI prints is written, with an ASCII
// fallback for terminals that cannot render it. A Windows console still
// running code page 437/1252, or a POSIX shell under `LANG=C`, turns "✓" into
// mojibake ("Ô£ô") — which makes a preflight table look broken at exactly the
// moment the user is deciding whether to spend money.
//
// THE HEURISTIC (deliberately conservative: ASCII only on positive evidence
// that the stream is not UTF-8, so a normal terminal keeps the nice glyphs):
//   1. SAYLENT_ASCII=1 forces ASCII; SAYLENT_UNICODE=1 forces glyphs. Escape
//      hatches first, so nobody is stuck with a wrong guess.
//   2. process.stdout's own default encoding, when it has been set to
//      something that is not utf8 (a wrapper piping us through a legacy
//      encoder) — the only direct signal Node exposes about the stream.
//   3. POSIX locale: LC_ALL / LC_CTYPE / LANG. This is the variable that
//      DECLARES the stream's encoding, so it is checked before any
//      capability guess: "C.UTF-8"/"en_US.UTF-8" -> glyphs, "C"/"POSIX"/
//      "en_US.ISO-8859-1" -> ASCII. If none is set we fall through (many CI
//      images set no locale at all yet render UTF-8 fine).
//   4. Windows: the active code page is what decides, and reading it means
//      shelling out to `chcp` — too expensive for every line of output, so we
//      use the terminals that are known to run code page 65001 instead:
//      Windows Terminal (WT_SESSION), VS Code's terminal
//      (TERM_PROGRAM=vscode), ConEmu/Cmder (ConEmuANSI), any MSYS/Cygwin
//      shell (TERM set), or CI. Plain conhost (none of those) gets ASCII.
//   5. TERM=linux (a bare Linux VT) -> ASCII. TERM=dumb is deliberately NOT
//      a signal: it means "no cursor/colour capabilities", not "no UTF-8",
//      and CI runners set it while rendering UTF-8 correctly.
// Anything else -> glyphs.

/** Every glyph the CLI is allowed to print, with the ASCII stand-in used when
 *  the stream cannot carry it. Add here, never inline in a command. */
const GLYPHS = {
  check: ["✓", "+"],
  cross: ["✗", "x"],
  warn: ["⚠", "!"],
  star: ["★", "*"],
  up: ["▲", "^"],
  down: ["▼", "v"],
  dot: ["●", "*"],
  /** the list separator in "smoke · 6 questions · 2 engines" */
  sep: ["·", "-"],
  /** the numeric-range dash in "$0.40–$0.70" */
  ndash: ["–", "-"],
  /** the "OpenAI ↔ Anthropic" cross-family arrow */
  swap: ["↔", "<->"],
  ellipsis: ["…", "..."],
} as const;

export type GlyphName = keyof typeof GLYPHS;

function looksUtf8(value: string): boolean {
  return /utf-?8/i.test(value);
}

/** The heuristic above, as one boolean. Exported for the unit test; callers
 *  use glyph()/withGlyphs() instead. */
export function stdoutSupportsUnicode(
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
  encoding: string | undefined = (process.stdout as { defaultEncoding?: string } | undefined)?.defaultEncoding,
): boolean {
  if (env.SAYLENT_ASCII === "1") return false;
  if (env.SAYLENT_UNICODE === "1") return true;

  if (encoding && encoding !== "buffer" && !looksUtf8(encoding)) return false;

  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG;
  if (locale) return looksUtf8(locale);

  const term = env.TERM ?? "";
  if (platform === "win32") {
    return Boolean(env.WT_SESSION || env.ConEmuANSI || env.CI || term) || env.TERM_PROGRAM === "vscode";
  }
  return term !== "linux";
}

// Resolved once per process: the encoding of a stream does not change under a
// running command, and re-deciding per glyph would read env on every line.
let cached: boolean | null = null;

function unicodeOn(): boolean {
  if (cached === null) cached = stdoutSupportsUnicode();
  return cached;
}

/** Test seam: forget the cached decision (and optionally pin it). */
export function resetGlyphSupport(force?: boolean): void {
  cached = force ?? null;
}

/** The one accessor. `glyph("check")` is "✓" on a UTF-8 stream, "+" otherwise. */
export function glyph(name: GlyphName): string {
  const [unicode, ascii] = GLYPHS[name];
  return unicodeOn() ? unicode : ascii;
}

/** Swap every known glyph in an already-composed string for its ASCII
 *  stand-in. For strings that are easier to read written out (help text, a
 *  one-line banner) than assembled from glyph() calls. */
export function withGlyphs(text: string): string {
  if (unicodeOn()) return text;
  let out = text;
  for (const [unicode, ascii] of Object.values(GLYPHS)) {
    out = out.split(unicode).join(ascii);
  }
  return out;
}
