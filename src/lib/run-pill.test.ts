// Pill state derivation + tab-title signal. Pure logic; $0.
import { describe, expect, it } from "vitest";
import { derivePillState, tabSignalTitle, type PillRun } from "./run-pill";

const r = (o: Partial<PillRun>): PillRun => ({
  id: "run-1",
  brandName: "Metricly",
  stage: "",
  status: "running",
  created_at: "2026-07-10T09:00:00Z",
  ...o,
});

describe("derivePillState", () => {
  it("empty ⇒ idle, links to /app, no label", () => {
    const s = derivePillState([]);
    expect(s.kind).toBe("idle");
    expect(s.run).toBeNull();
    expect(s.href).toBe("/app");
    expect(s.label).toBe("");
  });

  it("queued ⇒ starting label + run href", () => {
    const s = derivePillState([r({ status: "queued" })]);
    expect(s.kind).toBe("queued");
    expect(s.label).toBe("Metricly · starting…");
    expect(s.href).toBe("/app/run/run-1");
  });

  it("running ⇒ stage label, strips the live detail, progress > 0", () => {
    const s = derivePillState([r({ status: "running", stage: "Asking Gemini · 3/6 answered" })]);
    expect(s.kind).toBe("running");
    expect(s.label).toBe("Metricly · Asking Gemini");
    expect(s.progressPct).toBeGreaterThan(0);
    expect(s.progressPct).toBeLessThan(100);
  });

  it("running with an off-list stage ⇒ falls back to 'running'", () => {
    const s = derivePillState([r({ status: "running", stage: "" })]);
    expect(s.label).toBe("Metricly · running");
  });

  it("done-flip ⇒ done pill, ready label, 100%", () => {
    const s = derivePillState([r({ status: "done", stage: "Writing your fix plan" })]);
    expect(s.kind).toBe("done");
    expect(s.label).toBe("✓ Metricly full report ready →");
    expect(s.progressPct).toBe(100);
  });

  it("failed ⇒ warn label with retry", () => {
    const s = derivePillState([r({ status: "failed" })]);
    expect(s.kind).toBe("failed");
    expect(s.label).toBe("Metricly run failed → retry");
  });

  it("multiple active ⇒ most recent is primary, +N tail counts other active, href → /app", () => {
    const s = derivePillState([
      r({ id: "old", brandName: "Trackflow", created_at: "2026-07-10T08:00:00Z" }),
      r({ id: "new", brandName: "Metricly", created_at: "2026-07-10T09:30:00Z" }),
    ]);
    expect(s.run?.id).toBe("new");
    expect(s.label).toContain("Metricly");
    expect(s.extraCount).toBe(1);
    expect(s.href).toBe("/app");
  });

  it("done primary + one still-active other ⇒ extraCount counts only active others", () => {
    const s = derivePillState([
      r({ id: "done1", status: "done", created_at: "2026-07-10T10:00:00Z" }),
      r({ id: "run2", status: "running", created_at: "2026-07-10T09:00:00Z" }),
    ]);
    expect(s.run?.id).toBe("done1");
    expect(s.kind).toBe("done");
    expect(s.extraCount).toBe(1);
  });

  it("blank brand name ⇒ safe fallback", () => {
    const s = derivePillState([r({ brandName: "", status: "queued" })]);
    expect(s.label).toBe("Your brand · starting…");
  });
});

describe("tabSignalTitle", () => {
  it("running ⇒ ▶ stage — Saylent", () => {
    const s = derivePillState([r({ status: "running", stage: "Asking Claude · 2/6" })]);
    expect(tabSignalTitle(s)).toBe("▶ Asking Claude — Saylent");
  });

  it("queued ⇒ ▶ Starting…", () => {
    const s = derivePillState([r({ status: "queued" })]);
    expect(tabSignalTitle(s)).toBe("▶ Starting… — Saylent");
  });

  it("done ⇒ ✓ Dossier ready", () => {
    const s = derivePillState([r({ status: "done" })]);
    expect(tabSignalTitle(s)).toBe("✓ Dossier ready — Saylent");
  });

  it("idle & failed ⇒ null (restore the page's own title)", () => {
    expect(tabSignalTitle(derivePillState([]))).toBeNull();
    expect(tabSignalTitle(derivePillState([r({ status: "failed" })]))).toBeNull();
  });
});
