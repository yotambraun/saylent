// Fix plan — presentation-layer de-templating. Source pitches
// on many hosts (fixKey `source-{host}`) collapse into one cluster; every other
// fix (unique fix_key) passes through as a singleton. pickTopMoves keeps the top
// moves with one group per shape so the top-3 never repeats the same kind of ask.
import { describe, expect, it } from "vitest";
import { groupFixes, pickTopMoves, type FixGroup, type FixLike } from "./fix-groups";

const fix = (o: Partial<FixLike> & Pick<FixLike, "fix_key">): FixLike => ({
  title: `Pitch ${o.fix_key?.replace(/^source-/, "")} — the engines cite it and you're not on it`,
  weight: 8,
  ...o,
});

const listicle = (host: string, weight: number): FixLike => ({
  fix_key: `source-${host}`,
  title: `Get added to ${host}'s list — the engines cite it and you're not on it`,
  weight,
});
const pitch = (host: string, weight: number): FixLike => ({
  fix_key: `source-${host}`,
  title: `Pitch ${host} — the engines cite it and you're not on it`,
  weight,
});
const comparison = (host: string, weight: number): FixLike => ({
  fix_key: `source-${host}`,
  title: `Get into ${host}'s comparison — the engines cite it and you're not on it`,
  weight,
});

describe("groupFixes", () => {
  it("collapses ≥2 same-shape source pitches into one cluster carrying children in weight order", () => {
    const groups = groupFixes([pitch("a.com", 8.5), pitch("b.com", 8.4), pitch("c.com", 8.6)]);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.kind).toBe("cluster");
    expect(g.shape).toBe("source");
    expect(g.fixes.map((f) => f.fix_key)).toEqual(["source-c.com", "source-a.com", "source-b.com"]);
    expect(g.groupWeight).toBe(8.6);
    expect(g.hosts).toEqual(["c.com", "a.com", "b.com"]);
  });

  it("names the cluster after the dominant page-type plural", () => {
    const g = groupFixes([listicle("a.com", 8.5), listicle("b.com", 8.4), listicle("c.com", 8.3)])[0];
    expect(g.title).toBe("Get onto the 3 listicles the engines trust: a drafted pitch for each");
  });

  it("falls back to 'sources' when the cluster mixes page types", () => {
    const g = groupFixes([listicle("a.com", 8.5), comparison("b.com", 8.4), pitch("c.com", 8.3)])[0];
    expect(g.title).toBe("Get onto the 3 sources the engines trust: a drafted pitch for each");
  });

  it("uses 'sources' for a pitch-only cluster (page type unknown from the title)", () => {
    const g = groupFixes([pitch("a.com", 8.5), pitch("b.com", 8.4), pitch("c.com", 8.3), pitch("d.com", 8.2)])[0];
    expect(g.title).toBe("Get onto the 4 sources the engines trust: a drafted pitch for each");
  });

  it("keeps a lone same-shape source fix as a singleton (cluster needs ≥2)", () => {
    const groups = groupFixes([pitch("a.com", 8.5)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("single");
    expect(groups[0].title).toBe("Pitch a.com — the engines cite it and you're not on it");
    expect(groups[0].hosts).toEqual(["a.com"]);
  });

  it("passes non-source fixes (unique fix_key) through unchanged as singletons", () => {
    const groups = groupFixes([
      fix({ fix_key: "coverage-hub", title: "Take back the 3 questions the engines answer without you", weight: 9 }),
      fix({ fix_key: "claims", title: "Correct the record: engines repeat negative claims", weight: 7 }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["single", "single"]);
    expect(groups.map((g) => g.shape)).toEqual(["coverage-hub", "claims"]);
    expect(groups[0].hosts).toEqual([]);
  });

  it("preserves overall weight order, placing a cluster at its max-child weight", () => {
    const groups = groupFixes([
      fix({ fix_key: "coverage-hub", title: "Take back the questions", weight: 8.6 }),
      pitch("a.com", 8.5),
      pitch("b.com", 8.4),
      fix({ fix_key: "claims", title: "Correct the record", weight: 7 }),
    ]);
    expect(groups.map((g) => g.shape)).toEqual(["coverage-hub", "source", "claims"]);
    expect(groups.map((g) => g.groupWeight)).toEqual([8.6, 8.5, 7]);
  });

  it("keeps genuinely different shapes separate rather than merging them", () => {
    const groups = groupFixes([
      pitch("a.com", 8.5),
      pitch("b.com", 8.4),
      fix({ fix_key: "schema_missing", title: "Add Organization and Product JSON-LD", weight: 5.5 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.shape)).toEqual(["source", "schema_missing"]);
  });

  it("returns [] on empty input", () => {
    expect(groupFixes([])).toEqual([]);
  });
});

describe("pickTopMoves", () => {
  const groups = groupFixes([
    fix({ fix_key: "coverage-hub", title: "Take back the questions", weight: 9 }),
    pitch("a.com", 8.5),
    pitch("b.com", 8.4),
    fix({ fix_key: "claims", title: "Correct the record", weight: 7 }),
    fix({ fix_key: "schema_missing", title: "Add JSON-LD", weight: 5.5 }),
  ]);

  it("returns the top n distinct shapes by weight", () => {
    const top = pickTopMoves(groups, 3);
    expect(top.map((g) => g.shape)).toEqual(["coverage-hub", "source", "claims"]);
  });

  it("never returns two groups of the same shape", () => {
    const dupeSource: FixGroup[] = [
      { kind: "cluster", shape: "source", title: "Get onto the 2 sources the engines trust: a drafted pitch for each", groupWeight: 9, fixes: [pitch("a.com", 9), pitch("b.com", 8)], hosts: ["a.com", "b.com"] },
      { kind: "single", shape: "source", title: "Pitch c.com — the engines cite it and you're not on it", groupWeight: 8.7, fixes: [pitch("c.com", 8.7)], hosts: ["c.com"] },
      { kind: "single", shape: "coverage-hub", title: "Take back the questions", groupWeight: 6, fixes: [fix({ fix_key: "coverage-hub", weight: 6 })], hosts: [] },
    ];
    const top = pickTopMoves(dupeSource, 3);
    expect(top.map((g) => g.shape)).toEqual(["source", "coverage-hub"]);
  });

  it("returns fewer than n when fewer distinct shapes exist", () => {
    expect(pickTopMoves(groups.slice(0, 1), 3)).toHaveLength(1);
    expect(pickTopMoves([], 3)).toEqual([]);
  });
});
