import { describe, expect, it } from "vitest";
import { computeConsumption, type DoneAudit, type EventRow } from "./consumption";

const NOW = new Date("2026-07-20T00:00:00Z");

function ev(event: string, at: string, props: Record<string, unknown> | null = null): EventRow {
  return { event, at, props };
}

describe("computeConsumption", () => {
  it("counts each event type and tracks receipt last-opened", () => {
    const events: EventRow[] = [
      ev("receipt_opened", "2026-07-01T10:00:00Z", { run_id: "r1" }),
      ev("receipt_opened", "2026-07-03T10:00:00Z", { run_id: "r1" }),
      ev("artifact_copied", "2026-07-02T10:00:00Z"),
      ev("fix_shipped", "2026-07-02T11:00:00Z"),
      ev("verify_run", "2026-07-04T09:00:00Z"),
      ev("signup", "2026-06-01T00:00:00Z"),
    ];
    const c = computeConsumption(events, [], NOW);
    expect(c.receiptsOpened.count).toBe(2);
    expect(c.receiptsOpened.lastAt).toBe("2026-07-03T10:00:00Z");
    expect(c.artifactsCopied).toBe(1);
    expect(c.fixesShipped).toBe(1);
    expect(c.verifyRuns).toBe(1);
    expect(c.lastActivity).toBe("2026-07-04T09:00:00Z");
  });

  it("no events → zeros and nulls, no flags", () => {
    const c = computeConsumption([], [], NOW);
    expect(c.receiptsOpened).toEqual({ count: 0, lastAt: null });
    expect(c.lastActivity).toBeNull();
    expect(c.neverOpened).toEqual([]);
  });

  it("flags a done audit opened by NOBODY within 7 days (window closed)", () => {
    const audits: DoneAudit[] = [{ id: "r1", finished_at: "2026-07-01T00:00:00Z" }];
    const c = computeConsumption([], audits, NOW);
    expect(c.neverOpened).toHaveLength(1);
    expect(c.neverOpened[0].runId).toBe("r1");
    expect(c.neverOpened[0].windowClosed).toBe(true); // finished 19d ago
  });

  it("does NOT flag when opened inside the window", () => {
    const audits: DoneAudit[] = [{ id: "r1", finished_at: "2026-07-01T00:00:00Z" }];
    const events = [ev("receipt_opened", "2026-07-05T00:00:00Z", { run_id: "r1" })];
    const c = computeConsumption(events, audits, NOW);
    expect(c.neverOpened).toHaveLength(0);
  });

  it("an open AFTER the 7-day window still counts as never-opened-in-window", () => {
    const audits: DoneAudit[] = [{ id: "r1", finished_at: "2026-07-01T00:00:00Z" }];
    const events = [ev("receipt_opened", "2026-07-12T00:00:00Z", { run_id: "r1" })]; // day 11
    const c = computeConsumption(events, audits, NOW);
    expect(c.neverOpened).toHaveLength(1);
  });

  it("a receipt_opened for a DIFFERENT run does not clear the flag", () => {
    const audits: DoneAudit[] = [{ id: "r1", finished_at: "2026-07-01T00:00:00Z" }];
    const events = [ev("receipt_opened", "2026-07-02T00:00:00Z", { run_id: "OTHER" })];
    const c = computeConsumption(events, audits, NOW);
    expect(c.neverOpened.map((n) => n.runId)).toEqual(["r1"]);
  });

  it("marks windowClosed=false for a fresh delivery still inside its window", () => {
    const audits: DoneAudit[] = [{ id: "r1", finished_at: "2026-07-18T00:00:00Z" }]; // 2d ago
    const c = computeConsumption([], audits, NOW);
    expect(c.neverOpened).toHaveLength(1);
    expect(c.neverOpened[0].windowClosed).toBe(false);
  });

  it("skips audits with no finished_at", () => {
    const audits: DoneAudit[] = [{ id: "r1", finished_at: null }];
    const c = computeConsumption([], audits, NOW);
    expect(c.neverOpened).toEqual([]);
  });
});
