import { describe, expect, it } from "vitest";
import { resolveRootRedirect } from "./root-redirect";

describe("resolveRootRedirect", () => {
  it("sends a signed-in user to /app", () => {
    expect(resolveRootRedirect({ id: "u1" })).toBe("/app");
  });

  it("sends a signed-out visitor to /login", () => {
    expect(resolveRootRedirect(null)).toBe("/login");
  });
});
