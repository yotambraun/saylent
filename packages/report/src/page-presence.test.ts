// Battlefield headline: page-presence vs the top rival
// over the VERIFIED cited pages (brand_present vs competitors_present counts),
// NOT answer share-of-voice. Wording must say "pages behind these answers".
import { describe, expect, it } from "vitest";
import { pagePresence, type PagePresencePage } from "./page-presence";

const page = (brand_present: boolean | null, competitors: string[]): PagePresencePage => ({
  brand_present,
  competitors_present: competitors,
});

describe("pagePresence", () => {
  it("counts brand/rival presence over verified pages and locks the P3 phrasing", () => {
    const result = pagePresence(
      [
        page(true, ["Otter", "Notecraft"]),
        page(false, ["Notecraft"]),
        page(true, ["Notecraft"]),
        page(false, ["Otter"]),
        page(null, ["Notecraft"]), // unverified — excluded from every count
      ],
      "Fathom",
    )!;
    expect(result.rivalName).toBe("Notecraft");
    expect(result.rivalPages).toBe(3);
    expect(result.brandPages).toBe(2);
    expect(result.verifiedPages).toBe(4);
    expect(result.totalPages).toBe(5);
    expect(result.sentence).toContain("pages behind these answers");
    expect(result.sentence).toBe(
      "Notecraft is on 3 of the 4 pages behind these answers we could verify; you're on 2.",
    );
  });

  it("breaks a top-rival tie deterministically by name", () => {
    const result = pagePresence([page(true, ["Zoom"]), page(false, ["Gong"])], "Fathom")!;
    expect(result.rivalName).toBe("Gong");
    expect(result.rivalPages).toBe(1);
  });

  it("never treats the audited brand or an alias as the rival", () => {
    const result = pagePresence(
      [page(true, ["Fathom", "FathomHQ", "Otter"]), page(false, ["Otter"])],
      "Fathom",
      ["FathomHQ"],
    )!;
    expect(result.rivalName).toBe("Otter");
    expect(result.rivalPages).toBe(2);
  });

  it("returns null when no page could be verified (V === 0)", () => {
    expect(pagePresence([page(null, ["Otter"]), page(null, ["Notecraft"])], "Fathom")).toBeNull();
  });

  it("returns null when no rival appears on any verified page", () => {
    expect(pagePresence([page(true, []), page(false, [])], "Fathom")).toBeNull();
  });

  it("returns null on an empty corpus", () => {
    expect(pagePresence([], "Fathom")).toBeNull();
  });
});
