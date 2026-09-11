// Guards a real bug: Postgres jsonb re-orders object keys canonically, so the
// UI must sort share_of_voice by count itself (see METHODOLOGY.md).
import { describe, expect, it } from "vitest";
import { sovEntries, topRival, topRivalPick, topRivalSentence } from "./sov";

// Key order below mimics jsonb canonical order (shorter keys first), NOT count
// order — exactly what runs.scores comes back as on a real stored run.
const JSONB_MANGLED = {
  Gong: 2,
  Zoom: 2,
  Avoma: 6,
  Otter: 14,
  Fathom: 16,
  Notecraft: 15,
};

describe("sovEntries", () => {
  it("returns entries sorted by count desc regardless of jsonb key order", () => {
    expect(sovEntries(JSONB_MANGLED).map(([name]) => name)).toEqual([
      "Fathom",
      "Notecraft",
      "Otter",
      "Avoma",
      "Gong",
      "Zoom",
    ]);
  });

  it("breaks count ties by name so order is stable across renders", () => {
    expect(sovEntries({ Zoom: 2, Gong: 2 })).toEqual([
      ["Gong", 2],
      ["Zoom", 2],
    ]);
  });

  it("handles null/undefined scores", () => {
    expect(sovEntries(null)).toEqual([]);
    expect(sovEntries(undefined)).toEqual([]);
  });
});

describe("topRival", () => {
  it("picks the highest-count entry that is not the audited brand", () => {
    expect(topRival(sovEntries(JSONB_MANGLED), "Fathom")).toEqual(["Notecraft", 15]);
  });

  it("is case-insensitive on the brand name", () => {
    expect(topRival(sovEntries(JSONB_MANGLED), "fathom")).toEqual(["Notecraft", 15]);
  });

  it("returns the top entry when the brand is absent from SOV (underdog case)", () => {
    expect(topRival(sovEntries(JSONB_MANGLED), "MeetGeek")).toEqual(["Fathom", 16]);
  });

  it("returns undefined for an empty list", () => {
    expect(topRival([], "MeetGeek")).toBeUndefined();
  });

  it("breaks a tie on the rival-section ordering when one is given", () => {
    expect(topRival(sovEntries({ A: 9, B: 9 }), "Brand", ["B"])).toEqual(["B", 9]);
  });
});

// A share-of-voice TIE used to be broken alphabetically and silently: the
// headline said "Beacon Uptime is named most, 9 times" while the rival section
// two screens down ranked Upcheck first. One report, two answers to "who wins".
describe("topRivalPick", () => {
  const entries = sovEntries({ "Beacon Uptime": 9, Upcheck: 9, Pingwatch: 5, "Kestrel Uptime": 0 });

  it("never picks the audited brand", () => {
    expect(topRivalPick(sovEntries({ Kestrel: 9, Rival: 2 }), "kestrel")?.name).toBe("Rival");
  });

  it("reports the tie instead of hiding it", () => {
    expect(topRivalPick(entries, "Kestrel Uptime")).toEqual({
      name: "Beacon Uptime",
      count: 9,
      tiedWith: ["Upcheck"],
    });
  });

  it("breaks the tie on the rival-section ordering, so both surfaces agree", () => {
    // rivalGaps ranks Upcheck first (it appears in more of the answers that skip you)
    expect(topRivalPick(entries, "Kestrel Uptime", ["Upcheck", "Beacon Uptime"])).toEqual({
      name: "Upcheck",
      count: 9,
      tiedWith: ["Beacon Uptime"],
    });
  });

  it("leaves an outright lead alone", () => {
    expect(topRivalPick(sovEntries({ A: 9, B: 4 }), "Brand", ["B"])).toEqual({
      name: "A",
      count: 9,
      tiedWith: [],
    });
  });

  it("is null when no rival was named", () => {
    expect(topRivalPick(sovEntries({ Kestrel: 3 }), "Kestrel")).toBeNull();
  });
});

describe("topRivalSentence", () => {
  it("says a tie out loud", () => {
    expect(topRivalSentence({ name: "Upcheck", count: 9, tiedWith: ["Beacon Uptime"] })).toBe(
      "Upcheck and Beacon Uptime are named most, 9 times each",
    );
  });
  it("lists three tied names", () => {
    expect(topRivalSentence({ name: "A", count: 2, tiedWith: ["B", "C"] })).toBe(
      "A, B and C are named most, 2 times each",
    );
  });
  it("keeps the plain sentence for an outright lead", () => {
    expect(topRivalSentence({ name: "A", count: 1, tiedWith: [] })).toBe("A is named most, 1 time");
  });
});
