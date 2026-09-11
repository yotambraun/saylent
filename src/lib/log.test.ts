// The structured logger emits one JSON line.
import { describe, expect, it } from "vitest";
import { formatLog } from "./log";

describe("formatLog", () => {
  it("emits parseable JSON with level, msg, and an ISO ts", () => {
    const parsed = JSON.parse(formatLog("info", "hello"));
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello");
    expect(typeof parsed.ts).toBe("string");
    expect(Number.isNaN(Date.parse(parsed.ts))).toBe(false);
  });

  it("merges context keys", () => {
    const parsed = JSON.parse(formatLog("warn", "cron dispatch refused", { brandId: "b1", n: 3 }));
    expect(parsed.brandId).toBe("b1");
    expect(parsed.n).toBe(3);
  });

  it("does not let context override the reserved keys", () => {
    const parsed = JSON.parse(formatLog("error", "x", { level: "info", msg: "spoof" }));
    expect(parsed.level).toBe("error");
    expect(parsed.msg).toBe("x");
  });

  it("never throws on an unserializable context (degrades cleanly)", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const line = formatLog("error", "boom", circular);
    const parsed = JSON.parse(line);
    expect(parsed.ctxError).toBe("unserializable");
    expect(parsed.msg).toBe("boom");
  });
});
