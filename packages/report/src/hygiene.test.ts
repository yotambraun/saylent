import { describe, expect, it } from "vitest";
import { isDeleted, isHidden, partitionByHidden } from "./hygiene";

describe("isHidden / isDeleted", () => {
  it("treats null/undefined as visible / live", () => {
    expect(isHidden({ hidden_at: null })).toBe(false);
    expect(isHidden({})).toBe(false);
    expect(isDeleted({ deleted_at: null })).toBe(false);
    expect(isDeleted({})).toBe(false);
  });
  it("treats a timestamp as hidden / deleted", () => {
    expect(isHidden({ hidden_at: "2026-07-21T00:00:00Z" })).toBe(true);
    expect(isDeleted({ deleted_at: "2026-07-21T00:00:00Z" })).toBe(true);
  });
});

describe("partitionByHidden", () => {
  it("splits into visible and hidden preserving order", () => {
    const rows = [
      { id: "a", hidden_at: null },
      { id: "b", hidden_at: "2026-07-01T00:00:00Z" },
      { id: "c" },
      { id: "d", hidden_at: "2026-07-02T00:00:00Z" },
    ];
    const { visible, hidden } = partitionByHidden(rows);
    expect(visible.map((r) => r.id)).toEqual(["a", "c"]);
    expect(hidden.map((r) => r.id)).toEqual(["b", "d"]);
  });
  it("handles an empty list", () => {
    expect(partitionByHidden([])).toEqual({ visible: [], hidden: [] });
  });
});
