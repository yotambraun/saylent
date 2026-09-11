// main.ts's own logic (not the network path — that's run.test.ts): the
// SAYLENT_ACTION_FAKE_RESULT fixture and the booleanInput default fallback
// @actions/core doesn't provide on its own.
import { afterEach, describe, expect, it } from "vitest";
import { parseFailOn, shouldFailJob } from "./fail-on";
import { booleanInput, fakeGateResult, resolveBadgePath } from "./main";
import { renderSummaryMarkdown } from "./summary";

afterEach(() => {
  delete process.env.INPUT_WRITE_BADGE;
});

describe("fakeGateResult (the DONE-CHECK's no-network escape hatch)", () => {
  it("produces a well-formed GateResult for the given domain", () => {
    const result = fakeGateResult("example.com");
    expect(result.domain).toBe("example.com");
    expect(result.classes).toHaveLength(3);
    expect(["pass", "warn", "fail"]).toContain(result.overall);
  });

  it("feeds a real summary render end to end", () => {
    const result = fakeGateResult("example.com");
    const md = renderSummaryMarkdown(result, parseFailOn("search,user"));
    expect(md).toContain("example.com");
    expect(md).toContain("Training");
  });

  it("does not fail the job under the default fail_on (its only blocked class is training)", () => {
    const result = fakeGateResult("example.com");
    expect(shouldFailJob(result.classes, parseFailOn("search,user"))).toBe(false);
  });
});

describe("resolveBadgePath (P4 security review #21 — confine badge_path to the workspace)", () => {
  const ROOT = "/home/runner/work/consumer-repo/consumer-repo";

  it("resolves a normal relative badge_path under the workspace", () => {
    expect(resolveBadgePath(ROOT, ".github/badges/ai-access.svg")).toBe(`${ROOT}/.github/badges/ai-access.svg`);
  });

  it("rejects a path that escapes the workspace via ..", () => {
    expect(resolveBadgePath(ROOT, "../../../../etc/cron.d/evil")).toBeNull();
    expect(resolveBadgePath(ROOT, "badges/../../../../etc/passwd")).toBeNull();
  });

  it("rejects an absolute path pointing elsewhere", () => {
    expect(resolveBadgePath(ROOT, "/etc/passwd")).toBeNull();
    expect(resolveBadgePath(ROOT, "/tmp/somewhere-else/badge.svg")).toBeNull();
  });

  it("rejects the workspace root itself (must name a file, not the root)", () => {
    expect(resolveBadgePath(ROOT, ".")).toBeNull();
  });

  it("accepts a nested path that merely walks up and back down inside the workspace", () => {
    expect(resolveBadgePath(ROOT, "a/../b/badge.svg")).toBe(`${ROOT}/b/badge.svg`);
  });
});

describe("booleanInput", () => {
  it("falls back to the given default when the env var is unset", () => {
    delete process.env.INPUT_WRITE_BADGE;
    expect(booleanInput("write_badge", true)).toBe(true);
    expect(booleanInput("write_badge", false)).toBe(false);
  });

  it("parses an explicit true/false, overriding the default", () => {
    process.env.INPUT_WRITE_BADGE = "false";
    expect(booleanInput("write_badge", true)).toBe(false);
    process.env.INPUT_WRITE_BADGE = "true";
    expect(booleanInput("write_badge", false)).toBe(true);
  });
});
