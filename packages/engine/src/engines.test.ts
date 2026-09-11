// Pure answer-engine selection rules.
import { describe, expect, it } from "vitest";
import {
  ALL_ENGINES,
  ENGINE_FLOOR,
  engineSetChanged,
  frozenEngines,
  normalizeSelection,
  resolveEngines,
} from "./engines";

describe("resolveEngines", () => {
  it("null / undefined / empty → all four (the default)", () => {
    expect(resolveEngines(null)).toEqual([...ALL_ENGINES]);
    expect(resolveEngines(undefined)).toEqual([...ALL_ENGINES]);
    expect(resolveEngines([])).toEqual([...ALL_ENGINES]);
  });

  it("a valid subset resolves in canonical order", () => {
    expect(resolveEngines(["claude", "chatgpt"])).toEqual(["chatgpt", "claude"]);
    expect(resolveEngines(["perplexity", "gemini"])).toEqual(["gemini", "perplexity"]);
  });

  it("dedupes and drops junk values", () => {
    expect(resolveEngines(["chatgpt", "chatgpt", "claude", "bogus"])).toEqual(["chatgpt", "claude"]);
  });

  it("below the floor → all four (never runs a one-engine audit)", () => {
    expect(resolveEngines(["chatgpt"])).toEqual([...ALL_ENGINES]);
    expect(resolveEngines(["nonsense"])).toEqual([...ALL_ENGINES]);
  });

  it("all four (any order) resolves to all four", () => {
    expect(resolveEngines(["perplexity", "gemini", "claude", "chatgpt"])).toEqual([...ALL_ENGINES]);
  });
});

describe("frozenEngines — the run always honors the frozen envelope, not the live column", () => {
  it("uses the envelope's frozen engines when present (a verify reuses the baseline set)", () => {
    // live column drifted to all-four, but the frozen set is a 2-engine subset → subset wins
    expect(frozenEngines({ engines: ["chatgpt", "claude"] }, null)).toEqual(["chatgpt", "claude"]);
    expect(frozenEngines({ engines: ["chatgpt", "claude"] }, ["gemini", "perplexity"])).toEqual([
      "chatgpt",
      "claude",
    ]);
  });

  it("falls back to the live column only when no set is frozen yet (first audit)", () => {
    expect(frozenEngines(null, ["chatgpt", "claude"])).toEqual(["chatgpt", "claude"]);
    expect(frozenEngines({ engines: [] }, ["gemini", "perplexity"])).toEqual(["gemini", "perplexity"]);
  });

  it("legacy envelope without engines + null column → all four", () => {
    expect(frozenEngines({}, null)).toEqual([...ALL_ENGINES]);
  });
});

describe("normalizeSelection — what to persist to brands.engines", () => {
  it("empty / all four → null (the default is stored as null)", () => {
    expect(normalizeSelection(undefined)).toEqual({ ok: true, store: null });
    expect(normalizeSelection([])).toEqual({ ok: true, store: null });
    expect(normalizeSelection([...ALL_ENGINES])).toEqual({ ok: true, store: null });
  });

  it("every user may narrow: a valid subset is stored in canonical order", () => {
    expect(normalizeSelection(["claude", "chatgpt"])).toEqual({
      ok: true,
      store: ["chatgpt", "claude"],
    });
  });

  it("a subset below the floor → error", () => {
    const r = normalizeSelection(["chatgpt"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(String(ENGINE_FLOOR));
  });

  it("junk-only selection → null (default), not an error", () => {
    expect(normalizeSelection(["bogus"])).toEqual({ ok: true, store: null });
  });
});

describe("engineSetChanged — the re-baseline trigger", () => {
  it("null vs null → no change", () => {
    expect(engineSetChanged(null, null)).toBe(false);
  });

  it("null vs the full four → no change (both = all four)", () => {
    expect(engineSetChanged(null, [...ALL_ENGINES])).toBe(false);
    expect(engineSetChanged([...ALL_ENGINES], null)).toBe(false);
  });

  it("all-four vs a narrowed subset → change (re-baseline fires)", () => {
    expect(engineSetChanged(null, ["chatgpt", "claude"])).toBe(true);
    expect(engineSetChanged(["chatgpt", "claude"], null)).toBe(true);
  });

  it("same subset in a different order → no change", () => {
    expect(engineSetChanged(["chatgpt", "claude"], ["claude", "chatgpt"])).toBe(false);
  });

  it("one subset vs a wider subset → change", () => {
    expect(engineSetChanged(["chatgpt", "claude"], ["chatgpt", "claude", "gemini"])).toBe(true);
  });
});
