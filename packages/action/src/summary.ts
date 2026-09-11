// Renders the GitHub Actions job summary (the Action's `summary`
// output) - a per-class table plus the other findings, written to $GITHUB_STEP_SUMMARY
// by main.ts. Pure function of a GateResult so it's testable without a real run.
import type { ClassKind, GateResult } from "./types";

const STATUS_WORD: Record<string, string> = {
  pass: "PASS ✓",
  warn: "WARN ⚠",
  fail: "FAIL ✗",
  info: "info",
};

function escapeCell(s: string): string {
  // Findings are joined into one table cell with <br>; keep pipes from breaking
  // the row and collapse literal newlines the same way.
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderSummaryMarkdown(result: GateResult, failOn?: Set<ClassKind>): string {
  const lines: string[] = [];
  lines.push(`## AI access gate — ${result.domain}`);
  lines.push("");
  lines.push(`**Result: ${STATUS_WORD[result.overall]}**`);
  lines.push("");
  lines.push("No LLM calls. No API keys. Robots.txt per bot class, a live per-user-agent");
  lines.push("probe, JSON-LD presence, and meta directives - see METHODOLOGY.md.");
  lines.push("");
  lines.push("| Bot class | Status | Fails this job? | Findings |");
  lines.push("|---|---|---|---|");
  for (const c of result.classes) {
    const gates = failOn ? (failOn.has(c.kind) ? "yes" : "no (not in `fail_on`)") : "-";
    const findings = c.findings.length > 0 ? c.findings.map(escapeCell).join("<br>") : "no bots of this class checked";
    lines.push(`| ${c.label} | ${STATUS_WORD[c.status]} | ${gates} | ${findings} |`);
  }
  lines.push("");
  if (result.other.length > 0) {
    lines.push("<details><summary>Other checks (JSON-LD, meta directives, coverage, freshness)</summary>");
    lines.push("");
    lines.push("| Check | Status | Detail |");
    lines.push("|---|---|---|");
    for (const o of result.other) {
      lines.push(`| ${escapeCell(o.check)} | ${STATUS_WORD[o.status]} | ${escapeCell(o.detail)} |`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }
  lines.push(
    "_This is a live probe from CI, run once, from GitHub's network. It is not proof of what a real bot sees in production, and it cannot see requests that never reach us - your server logs are ground truth._",
  );
  lines.push(`_Checked in ${(result.elapsedMs / 1000).toFixed(1)}s, $0._`);
  return `${lines.join("\n")}\n`;
}
