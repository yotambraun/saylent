import { describe, expect, it } from "vitest";
import { DEFAULT_FAIL_ON, parseFailOn, shouldFailJob } from "./fail-on";
import type { ClassRow } from "./types";

function row(kind: ClassRow["kind"], status: ClassRow["status"]): ClassRow {
  return { kind, label: kind, status, findings: [] };
}

describe("parseFailOn", () => {
  it("parses the default 'search,user'", () => {
    expect(parseFailOn(DEFAULT_FAIL_ON)).toEqual(new Set(["search", "user"]));
  });

  it("is whitespace- and case-insensitive, and drops unknown tokens", () => {
    expect(parseFailOn(" Search , USER , bogus ")).toEqual(new Set(["search", "user"]));
  });

  it("accepts training when opted in", () => {
    expect(parseFailOn("training,search,user")).toEqual(new Set(["training", "search", "user"]));
  });

  it("empty input yields an empty set (fails nothing)", () => {
    expect(parseFailOn("")).toEqual(new Set());
  });
});

describe("shouldFailJob (fails only on a BLOCKED class in fail_on)", () => {
  it("fails when a fail_on class is FAIL", () => {
    const classes = [row("training", "warn"), row("search", "fail"), row("user", "pass")];
    expect(shouldFailJob(classes, parseFailOn("search,user"))).toBe(true);
  });

  it("does not fail on a WARN, even for a class in fail_on", () => {
    const classes = [row("training", "warn"), row("search", "warn"), row("user", "pass")];
    expect(shouldFailJob(classes, parseFailOn("search,user"))).toBe(false);
  });

  it("a training block never fails the job unless the caller opts training into fail_on", () => {
    const classes = [row("training", "fail"), row("search", "pass"), row("user", "pass")];
    expect(shouldFailJob(classes, parseFailOn("search,user"))).toBe(false);
    expect(shouldFailJob(classes, parseFailOn("training"))).toBe(true);
  });

  it("an empty fail_on set never fails the job", () => {
    const classes = [row("training", "fail"), row("search", "fail"), row("user", "fail")];
    expect(shouldFailJob(classes, new Set())).toBe(false);
  });
});
