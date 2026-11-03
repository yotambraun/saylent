// The MCP `history` tool ($0): several runs of one brand side by side, and
// what moved between the oldest and the newest, with receipts. The movement
// events are the alert rules' own (computeAlerts via notify.ts
// payloadForBundles), so an agent, `verify --notify` and the weekly digest
// never describe one change two ways. Counts only; movement after a fix is
// correlation.
import path from "node:path";
import type { RunBundleV1 } from "@saylent/engine/bundle";
import { buildSourceHistory } from "@saylent/engine/sources";
import { sourceIntelFor } from "@saylent/report/data-export";
import { bundlePathsFor } from "../commands/export";
import { payloadForBundles } from "../notify";

export interface HistoryToolArgs {
  /** run.json files, run folders or a brand folder of <YYYY-MM-DD>/run.json */
  bundle_paths: string[];
}

export async function historyTool(
  args: HistoryToolArgs,
  deps: { loadBundle: (file: string) => Promise<RunBundleV1> },
): Promise<Record<string, unknown>> {
  const files = args.bundle_paths.flatMap((p) => bundlePathsFor(p));
  if (files.length < 2) throw new Error("history needs at least two runs: pass two run.json files or a brand folder with two dated runs.");
  const loaded = await Promise.all(files.map(async (f) => ({ file: f, bundle: await deps.loadBundle(f) })));
  const domains = new Set(loaded.map((l) => l.bundle.brand_model.domain || l.bundle.run.brand.domain));
  if (domains.size > 1) throw new Error(`Those runs are for different brands (${[...domains].join(", ")}). A history needs one brand.`);
  const date = (b: RunBundleV1) => b.run.finished_at ?? b.run.started_at;
  loaded.sort((a, b) => date(a.bundle).localeCompare(date(b.bundle)));
  const first = loaded[0];
  const last = loaded[loaded.length - 1];

  const runs = loaded.map(({ file, bundle: b }) => ({
    run_id: b.run.id,
    bundle_path: file,
    date: date(b),
    kind: b.run.kind,
    profile: b.run.profile,
    engines: b.run.engines,
    models: b.run.models,
    answered: b.scores?.overall.answered ?? null,
    recommended: b.scores?.overall.recommended ?? null,
    mentioned: b.scores?.overall.mentioned ?? null,
    per_engine: Object.fromEntries(
      Object.entries(b.scores?.per_engine ?? {}).map(([e, t]) => [e, { answered: t.answered, recommended: t.recommended, mentioned: t.mentioned }]),
    ),
  }));
  const sameQuestions =
    JSON.stringify(first.bundle.questions.map((q) => q.qid).sort()) === JSON.stringify(last.bundle.questions.map((q) => q.qid).sort());
  const reportOf = (f: string) => path.join(path.dirname(f), "report.html");
  const movement = payloadForBundles({
    baseline: first.bundle,
    current: last.bundle,
    type: "digest.weekly",
    reportPath: reportOf(last.file),
    baselinePath: reportOf(first.file),
  });
  const sources = buildSourceHistory(loaded.map(({ bundle: b }) => ({ runId: b.run.id, date: date(b), intel: sourceIntelFor(b).intel })));
  const delta = (k: "recommended" | "mentioned") => {
    const a = first.bundle.scores?.overall[k];
    const z = last.bundle.scores?.overall[k];
    return typeof a === "number" && typeof z === "number" ? z - a : null;
  };
  return {
    brand: last.bundle.brand_model.brand,
    domain: [...domains][0],
    runs,
    compared: {
      baseline_run_id: first.bundle.run.id,
      current_run_id: last.bundle.run.id,
      same_questions: sameQuestions,
      recommended_change: delta("recommended"),
      mentioned_change: delta("mentioned"),
      models_changed: JSON.stringify(first.bundle.run.models) !== JSON.stringify(last.bundle.run.models),
    },
    movement: { headline_events: movement.events.length, events: movement.events, more_events: movement.more_events },
    sources,
    note:
      (sameQuestions ? "" : "The two runs did not ask the same questions, so per-question movement covers only the questions both asked. ") +
      "Counts from the runs themselves. Movement after a fix is correlation, not proof the fix caused it; each event carries the answers it was read from.",
    cost_usd: 0,
  };
}
