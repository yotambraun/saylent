// The chart takeaway sentences are
// the accessible text equivalent of each SVG, so they must state the headline
// fact honestly: real counts, direction in words + ▲/▼ (never color alone),
// and the ±1-answer noise band called out as "flat" so a within-noise wobble
// is never sold as a trend.
import { describe, expect, it } from "vitest";
import { recTakeaway, sovTakeaway } from "./charts";

describe("recTakeaway", () => {
  it("returns '' when there is no data", () => {
    expect(recTakeaway([])).toBe("");
  });

  it("states the count and 'first run' when only one point exists", () => {
    const s = recTakeaway([{ rec: 3, answered: 6 }]);
    expect(s).toContain("Recommended in 3 of 6 answers");
    expect(s).toContain("first run");
    expect(s).not.toMatch(/[▲▼]/);
  });

  it("calls a clear rise up with the ▲ glyph and the previous value", () => {
    const s = recTakeaway([
      { rec: 2, answered: 12 },
      { rec: 4, answered: 12 },
    ]);
    expect(s).toBe("Recommended in 4 of 12 answers, up ▲ from 2 in the last run.");
  });

  it("calls a clear drop down with the ▼ glyph", () => {
    const s = recTakeaway([
      { rec: 5, answered: 12 },
      { rec: 1, answered: 12 },
    ]);
    expect(s).toContain("down ▼ from 5");
  });

  it("treats a ±1-answer change as flat inside the noise band (no trend glyph)", () => {
    const s = recTakeaway([
      { rec: 3, answered: 12 },
      { rec: 4, answered: 12 },
    ]);
    expect(s).toContain("noise band");
    expect(s).toContain("treat it as flat");
    expect(s).not.toMatch(/[▲▼]/);
  });

  it("says 'unchanged' when the count is identical to the last run", () => {
    const s = recTakeaway([
      { rec: 4, answered: 12 },
      { rec: 4, answered: 12 },
    ]);
    expect(s).toContain("unchanged from 4");
    expect(s).not.toMatch(/[▲▼]/);
  });

  it("uses the supplied subject and singular 'answer' for a 1-answer run", () => {
    const s = recTakeaway([{ rec: 1, answered: 1 }], "GPT-4 recommended you");
    expect(s).toContain("GPT-4 recommended you in 1 of 1 answer:");
    expect(s).not.toContain("answers");
  });
});

describe("sovTakeaway", () => {
  const brand = "Acme";

  it("states plainly when the brand was never mentioned", () => {
    const s = sovTakeaway([{ name: "Rival", points: [{ t: "2026-07-01", count: 3 }] }], brand);
    expect(s).toBe("Acme wasn't mentioned in any scored answer across these runs.");
  });

  it("is case-insensitive on the brand name and reports the latest count", () => {
    const s = sovTakeaway(
      [{ name: "acme", points: [{ t: "2026-07-01", count: 2 }] }],
      brand,
    );
    expect(s).toContain("Acme was mentioned 2 times in the latest run");
    expect(s).toContain("first run");
  });

  it("shows an increase with words + ▲ against the previous run", () => {
    const s = sovTakeaway(
      [
        {
          name: "Acme",
          points: [
            { t: "2026-07-01", count: 2 },
            { t: "2026-07-08", count: 5 },
          ],
        },
      ],
      brand,
    );
    expect(s).toContain("mentioned 5 times");
    expect(s).toContain("up ▲ from 2");
  });

  it("shows a decrease with words + ▼", () => {
    const s = sovTakeaway(
      [
        {
          name: "Acme",
          points: [
            { t: "2026-07-01", count: 5 },
            { t: "2026-07-08", count: 1 },
          ],
        },
      ],
      brand,
    );
    expect(s).toContain("mentioned 1 time ");
    expect(s).toContain("down ▼ from 5");
  });

  it("says 'unchanged' with no glyph when the count held steady", () => {
    const s = sovTakeaway(
      [
        {
          name: "Acme",
          points: [
            { t: "2026-07-01", count: 3 },
            { t: "2026-07-08", count: 3 },
          ],
        },
      ],
      brand,
    );
    expect(s).toContain("unchanged from 3");
    expect(s).not.toMatch(/[▲▼]/);
  });
});
