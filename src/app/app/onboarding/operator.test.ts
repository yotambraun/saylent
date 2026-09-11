// The first-operator card condition.
import { describe, expect, it } from "vitest";
import { shouldShowOperatorCard } from "./operator";

describe("shouldShowOperatorCard", () => {
  it("shows for an admin with no brands (the first-visit operator)", () => {
    expect(shouldShowOperatorCard({ role: "admin", brandCount: 0 })).toBe(true);
    expect(shouldShowOperatorCard({ role: "admin", brandCount: null })).toBe(true);
  });

  it("hides once the operator has a brand", () => {
    expect(shouldShowOperatorCard({ role: "admin", brandCount: 1 })).toBe(false);
  });

  it("hides for every non-admin, brands or not", () => {
    expect(shouldShowOperatorCard({ role: "user", brandCount: 0 })).toBe(false);
    expect(shouldShowOperatorCard({ role: null, brandCount: 0 })).toBe(false);
    expect(shouldShowOperatorCard({ role: undefined, brandCount: 0 })).toBe(false);
    expect(shouldShowOperatorCard({ role: "Admin", brandCount: 0 })).toBe(false);
  });
});
