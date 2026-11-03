// The MCP `history` tool over two copies of the Kestrel sample, the newer one
// with one answer that now recommends the brand: the movement names that
// question and engine, and the counts move by exactly one.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBundle, type RunBundleV1 } from "@saylent/engine/bundle";
import { historyTool } from "./history";

const SAMPLE = path.resolve(__dirname, "../../../../examples/kestrel/run.json");
const load = async (f: string) => readBundle(JSON.parse(readFileSync(f, "utf8"))) as RunBundleV1;

describe("history tool", () => {
  it("compares the oldest and newest run with receipts", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "saylent-history-"));
    const base = JSON.parse(readFileSync(SAMPLE, "utf8"));
    const next = JSON.parse(JSON.stringify(base));
    next.run.id = "00000000-0000-4000-8000-000000000002";
    next.run.started_at = "2026-10-20T10:00:00.000Z";
    next.run.finished_at = "2026-10-20T10:10:00.000Z";
    const a = next.answers.find((x: { ok: boolean; verdict?: unknown; engine: string }) => x.ok && x.verdict && x.engine === "claude");
    a.verdict = { ...a.verdict, brand_present: true, mention_type: "recommended", prominence: "first" };
    next.scores.overall.recommended += 1;
    next.scores.overall.mentioned += 1;
    for (const [d, body] of [["2026-09-10", base], ["2026-10-20", next]] as const) {
      mkdirSync(path.join(dir, d));
      writeFileSync(path.join(dir, d, "run.json"), JSON.stringify(body));
    }
    const r = (await historyTool({ bundle_paths: [dir] }, { loadBundle: load })) as {
      runs: { run_id: string }[];
      compared: { recommended_change: number; same_questions: boolean };
      movement: { events: { qid?: string; engine?: string; type: string }[] };
      cost_usd: number;
    };
    expect(r.runs.map((x) => x.run_id)).toEqual([base.run.id, next.run.id]);
    expect(r.compared.recommended_change).toBe(1);
    expect(r.compared.same_questions).toBe(true);
    expect(r.movement.events.some((e) => e.qid === a.qid && e.engine === "claude")).toBe(true);
    expect(r.cost_usd).toBe(0);
  });

  it("refuses runs of two brands", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "saylent-history-"));
    const base = JSON.parse(readFileSync(SAMPLE, "utf8"));
    const other = JSON.parse(JSON.stringify(base));
    other.brand_model.domain = "other.example";
    writeFileSync(path.join(dir, "a.json"), JSON.stringify(base));
    writeFileSync(path.join(dir, "b.json"), JSON.stringify(other));
    await expect(historyTool({ bundle_paths: [path.join(dir, "a.json"), path.join(dir, "b.json")] }, { loadBundle: load })).rejects.toThrow(/different brands/);
  });
});
