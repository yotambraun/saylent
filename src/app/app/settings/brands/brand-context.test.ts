// Colocated unit test for the icp/problems bounds (brand-context.ts).
import { describe, expect, it } from "vitest";
import { MAX_PROBLEMS, parseIcp, parseProblems } from "./brand-context";

describe("parseIcp", () => {
  it("trims and collapses whitespace", () => {
    expect(parseIcp("  B2B   SaaS  teams ")).toEqual({ ok: true, value: "B2B SaaS teams" });
  });
  it("allows empty (clears the field)", () => {
    expect(parseIcp("")).toEqual({ ok: true, value: "" });
  });
  it("rejects over-long input", () => {
    const res = parseIcp("x".repeat(161));
    expect(res.ok).toBe(false);
  });
});

describe("parseProblems", () => {
  it("splits CSV into a trimmed, non-empty list", () => {
    expect(parseProblems("slow pages, , origin overload ")).toEqual({
      ok: true,
      list: ["slow pages", "origin overload"],
    });
  });
  it("collapses internal whitespace per item", () => {
    expect(parseProblems("tracking   email   delivery")).toEqual({
      ok: true,
      list: ["tracking email delivery"],
    });
  });
  it("returns an empty list for empty input", () => {
    expect(parseProblems("")).toEqual({ ok: true, list: [] });
  });
  it("caps the number of problems", () => {
    const many = Array.from({ length: MAX_PROBLEMS + 1 }, (_, i) => `p${i}`).join(",");
    expect(parseProblems(many).ok).toBe(false);
  });
  it("rejects an over-long single problem", () => {
    expect(parseProblems("y".repeat(121)).ok).toBe(false);
  });
});
