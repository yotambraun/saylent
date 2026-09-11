// `saylent history <dir>` — the run table. Split into a pure
// formatter (unit-tested with no filesystem) and the directory scan itself.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { glyph } from "./glyphs";

export interface HistoryRow {
  date: string;
  kind: string; // "audit" | "verify" | a bare profile name when kind is unknown
  profile: string;
  /** the SAME denominator the report and the CLI's own Verdict line use: the
   *  real count of judged (scored) answers — never the frozen question count. */
  answered: number;
  mentioned: number;
  recommended: number;
  costUsd: number | null;
}

export function formatHistoryTable(rows: HistoryRow[]): string[] {
  const lines: string[] = [];
  let prevRecommended: number | null = null;
  for (const r of rows) {
    const kindLabel = r.kind === "verify" ? "verify" : r.profile;
    const cost = r.costUsd === null ? "not recorded" : `$${r.costUsd.toFixed(2)}`;
    const trend =
      prevRecommended === null
        ? ""
        : r.recommended > prevRecommended
          ? `   ${glyph("up")}`
          : r.recommended < prevRecommended
            ? `   ${glyph("down")}`
            : "";
    // Same numbers, same vocabulary as the report and the CLI's own Verdict
    // line: "mentioned <m> of <answered>" / "recommended <r> of <answered>".
    lines.push(
      `  ${r.date}  ${kindLabel.padEnd(6)} mentioned ${r.mentioned} of ${r.answered}` +
        `  ${glyph("sep")}  recommended ${r.recommended} of ${r.answered}   ${cost}${trend}`,
    );
    prevRecommended = r.recommended;
  }
  return lines;
}

const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;

interface BundleHead {
  run?: { kind?: string; profile?: string; est_cost_usd?: number | null; started_at?: string };
  scores?: { overall?: { answered?: number; mentioned?: number; recommended?: number } } | null;
}

/** One `<dir>/run.json` -> one row, or null when it is missing/malformed.
 *  `fallbackDate` is the folder name for the dated layout; a run.json sitting
 *  directly in a folder dates itself from its own `run.started_at`. */
function readRunRow(file: string, fallbackDate: string | null): HistoryRow | null {
  if (!existsSync(file)) return null;
  try {
    const bundle = JSON.parse(readFileSync(file, "utf8")) as BundleHead;
    const overall = bundle.scores?.overall;
    const date = fallbackDate ?? bundle.run?.started_at?.slice(0, 10) ?? "undated";
    return {
      date,
      kind: bundle.run?.kind ?? "audit",
      profile: bundle.run?.profile ?? "unknown",
      // Same denominator the report and the CLI Verdict line use: the real
      // judged-answer count (overall.answered), never the frozen question
      // count — a run.json with no scores yet has answered 0 of 0.
      answered: overall?.answered ?? 0,
      mentioned: overall?.mentioned ?? 0,
      recommended: overall?.recommended ?? 0,
      costUsd: bundle.run?.est_cost_usd ?? null,
    };
  } catch {
    /* a malformed run.json is skipped, not fatal to the whole listing */
    return null;
  }
}

/** Scan `dir` for `<date>/run.json` subdirectories (the CLI's own output
 *  layout, `./<domain>/<YYYY-MM-DD>/`) and return them oldest-first.
 *
 *  A `run.json` sitting DIRECTLY in `dir` counts too: that is the shape of
 *  every hand-made folder and of this repo's own shipped sample
 *  (`examples/kestrel/`), and `saylent history examples/kestrel` used to
 *  answer "No runs found" while staring straight at one. */
export function scanHistoryDir(dir: string): HistoryRow[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && DATE_DIR.test(e.name))
    .map((e) => e.name)
    .sort();

  const rows: HistoryRow[] = [];
  for (const date of entries) {
    const row = readRunRow(path.join(dir, date, "run.json"), date);
    if (row) rows.push(row);
  }
  const direct = readRunRow(path.join(dir, "run.json"), null);
  if (direct) rows.push(direct);
  return rows;
}
