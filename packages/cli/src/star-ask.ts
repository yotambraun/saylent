// The one-time "star the repo" ask.
//
// WHERE it prints matters more than the wording: asking for a favour right after
// somebody has just spent real money on an audit reads as a toll. So the ask is
// attached to the two $0 surfaces instead — the first successful `gate-check`
// (which costs nothing and has just produced something useful) and `--version`.
// It prints at most once ever, tracked by a marker file in ~/.saylent.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { saylentHome } from "./keys";
import { glyph } from "./glyphs";

export const STAR_LINE = `  ${glyph("star")} Useful? Star the repo: github.com/yotambraun/saylent   (shown once)`;

/** Absolute path of the "we already asked" marker. */
export function starMarkerPath(): string {
  return path.join(saylentHome(), "star-asked");
}

/** True when the ask has not been shown yet. Any filesystem problem answers
 *  "already asked", so a read-only HOME can never turn this into a nag. */
export function starAskPending(): boolean {
  try {
    return !existsSync(starMarkerPath());
  } catch {
    return false;
  }
}

/** Print the ask at most once, then record that we did. `write` takes a full
 *  line without its trailing newline, matching Progress.write. */
export function maybeStarAsk(write: (line: string) => void): void {
  if (!starAskPending()) return;
  write("");
  write(STAR_LINE);
  try {
    mkdirSync(saylentHome(), { recursive: true });
    writeFileSync(starMarkerPath(), new Date().toISOString());
  } catch {
    // Cosmetic. Never fail a command over the marker file — worst case the ask
    // shows again next time.
  }
}
