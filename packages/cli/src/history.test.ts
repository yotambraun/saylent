import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatHistoryTable, scanHistoryDir, type HistoryRow } from "./history";

describe("formatHistoryTable", () => {
  it("formats the history table shape: date, kind/profile, mentioned, recommended, cost — same vocabulary as the report", () => {
    const rows: HistoryRow[] = [
      { date: "2026-09-09", kind: "audit", profile: "smoke", answered: 8, mentioned: 2, recommended: 0, costUsd: 0.42 },
      { date: "2026-09-16", kind: "verify", profile: "smoke", answered: 8, mentioned: 5, recommended: 2, costUsd: 0.39 },
    ];
    const lines = formatHistoryTable(rows);
    expect(lines[0]).toContain("2026-09-09");
    expect(lines[0]).toContain("mentioned 2 of 8");
    expect(lines[0]).toContain("recommended 0 of 8");
    expect(lines[0]).toContain("$0.42");
    expect(lines[1]).toContain("verify");
    expect(lines[1]).toContain("▲"); // recommended went 0 -> 2
  });

  it("matches examples/kestrel/run.json's own numbers and wording", () => {
    // scores.overall = { answered: 9, recommended: 0, mentioned: 0 } — the
    // report says "mentioned 0 of 9 · recommended 0 of 9"; history must too.
    const row: HistoryRow = { date: "2026-09-09", kind: "audit", profile: "smoke", answered: 9, mentioned: 0, recommended: 0, costUsd: 0.93 };
    const line = formatHistoryTable([row])[0];
    expect(line).toContain("mentioned 0 of 9");
    expect(line).toContain("recommended 0 of 9");
  });

  it("marks a decline with ▼ and a flat run with no arrow", () => {
    const up: HistoryRow = { date: "d1", kind: "audit", profile: "smoke", answered: 1, mentioned: 1, recommended: 3, costUsd: 0 };
    const down: HistoryRow = { date: "d2", kind: "audit", profile: "smoke", answered: 1, mentioned: 1, recommended: 1, costUsd: 0 };
    const flat: HistoryRow = { date: "d3", kind: "audit", profile: "smoke", answered: 1, mentioned: 1, recommended: 1, costUsd: 0 };
    const lines = formatHistoryTable([up, down, flat]);
    expect(lines[0]).not.toMatch(/[▲▼]/); // first row has no previous to compare
    expect(lines[1]).toContain("▼");
    expect(lines[2]).not.toMatch(/[▲▼]/);
  });

  it("prints 'not recorded' rather than $0.00 for a null cost", () => {
    const row: HistoryRow = { date: "d1", kind: "audit", profile: "smoke", answered: 0, mentioned: 0, recommended: 0, costUsd: null };
    expect(formatHistoryTable([row])[0]).toContain("not recorded");
  });
});

describe("scanHistoryDir", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("returns [] for a missing directory", () => {
    expect(scanHistoryDir(path.join(tmpdir(), "does-not-exist-xyz"))).toEqual([]);
  });

  it("reads <date>/run.json subdirectories, oldest first", () => {
    dir = mkdtempSync(path.join(tmpdir(), "saylent-history-"));
    const bundle = (overrides: Record<string, unknown>) => ({
      version: 1,
      run: { kind: "audit", profile: "smoke", est_cost_usd: 0.42, ...overrides },
      scores: { overall: { answered: 2, recommended: 1 } },
      questions: [{ qid: "q01" }, { qid: "q02" }],
    });
    mkdirSync(path.join(dir, "2026-09-16"), { recursive: true });
    writeFileSync(path.join(dir, "2026-09-16", "run.json"), JSON.stringify(bundle({ kind: "verify" })));
    mkdirSync(path.join(dir, "2026-09-09"), { recursive: true });
    writeFileSync(path.join(dir, "2026-09-09", "run.json"), JSON.stringify(bundle({})));
    mkdirSync(path.join(dir, "not-a-date"), { recursive: true }); // ignored, no date-shaped name

    const rows = scanHistoryDir(dir);
    expect(rows.map((r) => r.date)).toEqual(["2026-09-09", "2026-09-16"]);
    expect(rows[1].kind).toBe("verify");
    expect(rows[0].recommended).toBe(1);
  });

  it("skips a directory with no run.json or a malformed one, without throwing", () => {
    dir = mkdtempSync(path.join(tmpdir(), "saylent-history-"));
    mkdirSync(path.join(dir, "2026-01-01"), { recursive: true }); // no run.json
    mkdirSync(path.join(dir, "2026-01-02"), { recursive: true });
    writeFileSync(path.join(dir, "2026-01-02", "run.json"), "{ not json");
    expect(scanHistoryDir(dir)).toEqual([]);
  });

  // #19: `saylent history examples/kestrel` used to answer "No runs found"
  // while staring straight at examples/kestrel/run.json.
  it("also reads a run.json sitting DIRECTLY in the folder, dated from the run", () => {
    dir = mkdtempSync(path.join(tmpdir(), "saylent-history-"));
    writeFileSync(
      path.join(dir, "run.json"),
      JSON.stringify({
        version: 1,
        run: { kind: "audit", profile: "smoke", est_cost_usd: 0.93, started_at: "2026-09-09T14:59:43.437Z" },
        scores: { overall: { answered: 9, recommended: 0 } },
        questions: [{ qid: "q01" }],
      }),
    );
    const rows = scanHistoryDir(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("2026-09-09");
    expect(rows[0].costUsd).toBe(0.93);
  });

  it("a bare run.json with no started_at is listed as undated, not dropped", () => {
    dir = mkdtempSync(path.join(tmpdir(), "saylent-history-"));
    writeFileSync(path.join(dir, "run.json"), JSON.stringify({ version: 1, run: { profile: "full" } }));
    expect(scanHistoryDir(dir).map((r) => r.date)).toEqual(["undated"]);
  });
});
