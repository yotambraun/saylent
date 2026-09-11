// Cross-run fix queue: dedupe by (brand, fix_key), status
// lifecycle Open → Shipped → Watched (verify ran after shipping), watch note
// attached verbatim from the verify run's scores.
import { describe, expect, it } from "vitest";
import { fixWinRate, normalizeFixKey, trackFixes } from "./fix-tracker";

const fix = (o: Partial<Parameters<typeof trackFixes>[0][number]>) => ({
  id: "fix-row-1",
  fix_key: "coverage_gap:q10",
  title: "Publish a page that answers q10",
  factor: "coverage_gap",
  weight: "9",
  effort: "M",
  published_at: null as string | null,
  run_id: "run-1",
  brand_id: "brand-a",
  run_created_at: "2026-07-01T09:00:00Z",
  has_artifact: false,
  evidence: [] as string[],
  ...o,
});

describe("normalizeFixKey", () => {
  it("strips a leading www. and lowercases the host of a source pitch key", () => {
    expect(normalizeFixKey("source-www.G2.com")).toBe("source-g2.com");
    expect(normalizeFixKey("source-www.reddit.com")).toBe("source-reddit.com");
    expect(normalizeFixKey("source-reddit.com")).toBe("source-reddit.com");
  });

  it("leaves every stable (non-source) key untouched", () => {
    for (const k of [
      "access",
      "coverage-hub",
      "schema_missing",
      "claims",
      "citation-longtail",
      "citation-competitor-owned",
      "entity_unclear",
      "freshness_stale",
      "coverage_gap:q10",
    ]) {
      expect(normalizeFixKey(k)).toBe(k);
    }
  });
});

describe("trackFixes", () => {
  it("consolidates a source pitch that drifted between www./non-www hosts across runs into ONE row", () => {
    const rows = trackFixes(
      [
        fix({
          id: "r1",
          fix_key: "source-www.g2.com",
          run_id: "run-1",
          run_created_at: "2026-07-01T09:00:00Z",
        }),
        fix({
          id: "r2",
          fix_key: "source-g2.com",
          run_id: "run-2",
          run_created_at: "2026-07-05T09:00:00Z",
        }),
      ],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].occurrences).toBe(2);
    // canonical key + latest occurrence's run link
    expect(rows[0].fix_key).toBe("source-g2.com");
    expect(rows[0].run_id).toBe("run-2");
    expect(rows[0].first_seen).toBe("2026-07-01T09:00:00Z");
    expect(rows[0].last_seen).toBe("2026-07-05T09:00:00Z");
  });

  it("dedupes the same fix_key across runs of one brand, keeping the latest occurrence's fields and counting recurrences", () => {
    const rows = trackFixes(
      [
        fix({ id: "row-old", run_id: "run-1", run_created_at: "2026-07-01T09:00:00Z", weight: "8" }),
        fix({ id: "row-new", run_id: "run-2", run_created_at: "2026-07-05T09:00:00Z", weight: "9", has_artifact: true }),
      ],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].occurrences).toBe(2);
    expect(rows[0].run_id).toBe("run-2");
    expect(rows[0].id).toBe("row-new");
    expect(rows[0].weight).toBe(9);
    expect(rows[0].has_artifact).toBe(true);
    expect(rows[0].first_seen).toBe("2026-07-01T09:00:00Z");
  });

  it("does NOT merge the same fix_key across different brands", () => {
    const rows = trackFixes(
      [fix({ brand_id: "brand-a" }), fix({ brand_id: "brand-b" })],
      [],
    );
    expect(rows).toHaveLength(2);
  });

  it("status is open when never shipped", () => {
    expect(trackFixes([fix({})], [])[0].status).toBe("open");
  });

  it("status is shipped when published but no verify ran after", () => {
    const rows = trackFixes(
      [fix({ published_at: "2026-07-03T09:00:00Z" })],
      [
        {
          brand_id: "brand-a",
          created_at: "2026-07-02T09:00:00Z", // BEFORE shipping — doesn't count
          watch_notes: [{ fixKey: "coverage_gap:q10", note: "irrelevant" }],
        },
      ],
    );
    expect(rows[0].status).toBe("shipped");
    expect(rows[0].watch_note).toBeNull();
  });

  it("status is watched with the LATEST post-ship verify's note for this fixKey", () => {
    const rows = trackFixes(
      [fix({ published_at: "2026-07-03T09:00:00Z" })],
      [
        {
          brand_id: "brand-a",
          created_at: "2026-07-04T09:00:00Z",
          watch_notes: [{ fixKey: "coverage_gap:q10", note: "no movement yet — within the stated 2-4 weeks" }],
        },
        {
          brand_id: "brand-a",
          created_at: "2026-07-06T09:00:00Z",
          watch_notes: [{ fixKey: "coverage_gap:q10", note: "+1 question now names you (chatgpt)" }],
        },
      ],
    );
    expect(rows[0].status).toBe("watched");
    expect(rows[0].watch_note).toBe("+1 question now names you (chatgpt)");
  });

  it("a verify for ANOTHER brand never watches this fix", () => {
    const rows = trackFixes(
      [fix({ published_at: "2026-07-03T09:00:00Z" })],
      [
        {
          brand_id: "brand-b",
          created_at: "2026-07-04T09:00:00Z",
          watch_notes: [{ fixKey: "coverage_gap:q10", note: "wrong brand" }],
        },
      ],
    );
    expect(rows[0].status).toBe("shipped");
  });

  it("sorts open (by weight desc) before shipped before watched", () => {
    const rows = trackFixes(
      [
        fix({ fix_key: "a", weight: "5" }),
        fix({ fix_key: "b", weight: "9" }),
        fix({ fix_key: "c", published_at: "2026-07-05T09:00:00Z" }), // shipped AFTER the verify → not watched yet
        fix({ fix_key: "d", published_at: "2026-07-02T09:00:00Z" }),
      ],
      [
        {
          brand_id: "brand-a",
          created_at: "2026-07-04T09:00:00Z",
          watch_notes: [{ fixKey: "d", note: "watched note" }],
        },
      ],
    );
    expect(rows.map((r) => [r.fix_key, r.status])).toEqual([
      ["b", "open"],
      ["a", "open"],
      ["c", "shipped"],
      ["d", "watched"],
    ]);
  });

  it("moved is null until watched, false when watched with no newly-present qids, true when the metric moved", () => {
    const open = trackFixes([fix({})], [])[0];
    expect(open.moved).toBeNull();

    const watchedNoMove = trackFixes(
      [fix({ published_at: "2026-07-03T09:00:00Z" })],
      [
        {
          brand_id: "brand-a",
          created_at: "2026-07-04T09:00:00Z",
          watch_notes: [{ fixKey: "coverage_gap:q10", note: "no movement yet", newlyPresentQids: [] }],
        },
      ],
    )[0];
    expect(watchedNoMove.status).toBe("watched");
    expect(watchedNoMove.moved).toBe(false);

    const watchedMoved = trackFixes(
      [fix({ published_at: "2026-07-03T09:00:00Z" })],
      [
        {
          brand_id: "brand-a",
          created_at: "2026-07-04T09:00:00Z",
          watch_notes: [{ fixKey: "coverage_gap:q10", note: "+1 now names you", newlyPresentQids: ["q10"] }],
        },
      ],
    )[0];
    expect(watchedMoved.moved).toBe(true);
  });

  it("carries the latest occurrence's evidence lines", () => {
    const rows = trackFixes(
      [
        fix({ run_id: "run-1", run_created_at: "2026-07-01T09:00:00Z", evidence: ["old"] }),
        fix({ run_id: "run-2", run_created_at: "2026-07-05T09:00:00Z", evidence: ["q10: no page answers this", "citation mix: 0 owned"] }),
      ],
      [],
    );
    expect(rows[0].evidence).toEqual(["q10: no page answers this", "citation mix: 0 owned"]);
  });
});

describe("fixWinRate", () => {
  const shipped = (o: Partial<Parameters<typeof trackFixes>[0][number]>) =>
    fix({ published_at: "2026-07-03T09:00:00Z", ...o });
  const verify = (notes: { fixKey: string; note: string; newlyPresentQids?: string[] }[]) => ({
    brand_id: "brand-a",
    created_at: "2026-07-04T09:00:00Z",
    watch_notes: notes,
  });

  it("counts watched fixes and how many moved a metric; no percentage below n=3", () => {
    const tracked = trackFixes(
      [
        shipped({ fix_key: "a" }),
        shipped({ fix_key: "b" }),
      ],
      [
        verify([
          { fixKey: "a", note: "moved", newlyPresentQids: ["q01"] },
          { fixKey: "b", note: "flat", newlyPresentQids: [] },
        ]),
      ],
    );
    const wr = fixWinRate(tracked);
    expect(wr.watched).toBe(2);
    expect(wr.moved).toBe(1);
    expect(wr.pct).toBeNull(); // n<3 ⇒ counts only, honest low-n handling
  });

  it("reports a percentage once n>=3", () => {
    const tracked = trackFixes(
      [
        shipped({ fix_key: "a" }),
        shipped({ fix_key: "b" }),
        shipped({ fix_key: "c" }),
        shipped({ fix_key: "d" }),
      ],
      [
        verify([
          { fixKey: "a", note: "moved", newlyPresentQids: ["q01"] },
          { fixKey: "b", note: "moved", newlyPresentQids: ["q02"] },
          { fixKey: "c", note: "moved", newlyPresentQids: ["q03"] },
          { fixKey: "d", note: "flat", newlyPresentQids: [] },
        ]),
      ],
    );
    const wr = fixWinRate(tracked);
    expect(wr.watched).toBe(4);
    expect(wr.moved).toBe(3);
    expect(wr.pct).toBe(75);
  });

  it("is all-zero and null with no watched fixes", () => {
    expect(fixWinRate(trackFixes([fix({})], []))).toEqual({ watched: 0, moved: 0, pct: null });
  });

  it("does NOT double-count a www-drifted source pitch — it is one consolidated watched fix", () => {
    const tracked = trackFixes(
      [
        shipped({ id: "r1", fix_key: "source-www.g2.com", run_id: "run-1", run_created_at: "2026-07-01T09:00:00Z" }),
        shipped({ id: "r2", fix_key: "source-g2.com", run_id: "run-2", run_created_at: "2026-07-02T09:00:00Z" }),
      ],
      [
        // note fixKey is the engine's raw www form — must still match the consolidated row
        verify([{ fixKey: "source-www.g2.com", note: "now cited", newlyPresentQids: ["q01"] }]),
      ],
    );
    expect(tracked).toHaveLength(1);
    const wr = fixWinRate(tracked);
    expect(wr.watched).toBe(1);
    expect(wr.moved).toBe(1);
  });
});
