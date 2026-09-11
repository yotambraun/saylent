// The star ask must be shown at most once, and only from $0 surfaces. HOME is
// redirected at a temp dir so the marker never touches the real ~/.saylent.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maybeStarAsk, STAR_LINE, starAskPending, starMarkerPath } from "./star-ask";

let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "saylent-star-home-"));
  process.env.HOME = home;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  process.env.HOME = prevHome;
});

describe("maybeStarAsk", () => {
  it("prints once, then never again", () => {
    const first: string[] = [];
    maybeStarAsk((l) => first.push(l));
    expect(first.join("\n")).toContain(STAR_LINE.trim());

    const second: string[] = [];
    maybeStarAsk((l) => second.push(l));
    expect(second).toEqual([]);
  });

  it("stays silent when the marker already exists", () => {
    mkdirSync(path.dirname(starMarkerPath()), { recursive: true });
    writeFileSync(starMarkerPath(), "2026-01-01");
    expect(starAskPending()).toBe(false);

    const lines: string[] = [];
    maybeStarAsk((l) => lines.push(l));
    expect(lines).toEqual([]);
  });

  it("asks for a star and nothing else — no upsell, no link to a paid thing", () => {
    expect(STAR_LINE).toMatch(/star the repo/i);
    expect(STAR_LINE).not.toMatch(/upgrade|pricing|plan|buy|\$/i);
  });
});
