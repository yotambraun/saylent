import { describe, expect, it } from "vitest";
import { runTotals, totalsLine, failuresLine } from "./totals";

const a = (ok: boolean, qtype = "category") => ({ ok, qtype });

describe("runTotals", () => {
  it("counts asked / answered / failed and takes the stored scored count", () => {
    const answers = [...Array(18)].map(() => a(true)).concat([...Array(6)].map(() => a(false)));
    expect(runTotals(answers, 9)).toEqual({ asked: 24, answered: 18, failed: 6, scored: 9 });
  });

  it("falls back to counting scored qtypes when no stored count is given", () => {
    const answers = [a(true, "category"), a(true, "problem"), a(true, "branded"), a(false, "category")];
    expect(runTotals(answers)).toEqual({ asked: 4, answered: 3, failed: 1, scored: 2 });
  });

  it("treats a missing ok flag as answered (older rows)", () => {
    expect(runTotals([{ qtype: "category" }]).answered).toBe(1);
  });
});

describe("totalsLine", () => {
  it("is the one wording every surface uses", () => {
    expect(totalsLine({ asked: 24, answered: 18, failed: 6, scored: 9 })).toBe(
      "24 asked · 18 answered · 6 engine failures · 9 scored",
    );
  });
  it("singularises one failure", () => {
    expect(totalsLine({ asked: 24, answered: 23, failed: 1, scored: 9 })).toContain("1 engine failure ·");
  });
  it("drops the failures term on a clean run", () => {
    expect(totalsLine({ asked: 24, answered: 24, failed: 0, scored: 9 })).toBe(
      "24 asked · 24 answered · 9 scored",
    );
  });
});

describe("failuresLine", () => {
  it("says out loud how many calls returned nothing", () => {
    expect(failuresLine({ asked: 24, answered: 18, failed: 6, scored: 9 })).toContain(
      "6 of the 24 calls returned no answer",
    );
  });
  it("is null when nothing failed", () => {
    expect(failuresLine({ asked: 24, answered: 24, failed: 0, scored: 9 })).toBeNull();
  });
});
