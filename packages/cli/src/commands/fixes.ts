// `saylent fixes <run.json>` — the drafted fixes of a run with the evidence
// behind each, $0. `saylent fixes apply <run.json> --repo <path>` writes the
// site-side ones (robots.txt groups, JSON-LD snippets) into a local site repo
// on a new branch, with a pull-request description carrying the receipts. It
// shows the diff and asks first; it never pushes. See ../fixes-apply.ts.
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { existsSync, statSync } from "node:fs";
import type { RunBundleV1 } from "@saylent/engine/bundle";
import { engineLabel } from "@saylent/engine/surfaces";
import { glyph } from "../glyphs";
import { HELP_OPTION, opt, options } from "../help";
import { loadBundleFileAsync } from "../run";
import { applyPlan, checkRepo, fixesPayload, freeBranchName, planDiff, planFixApply, repoView } from "../fixes-apply";

const HELP = `saylent fixes <run.json> [options]
saylent fixes apply <run.json> --repo <path> [options]

The fixes a run drafted, ranked, with the evidence behind each. $0.

"fixes apply" writes the site-side ones into your own site repository:
robots.txt groups for the AI crawlers a run found refused, and the JSON-LD
blocks it drafted (as snippet files, with where each one goes). It works on a
new branch, shows the diff and asks before writing, commits locally with a
PULL_REQUEST.md that carries the receipts, and never pushes: it prints the
git push and gh pr create commands for you to run.

Options:
${options([
  opt("--fix <key>", "One fix, with its full drafted artifact"),
  opt("--json", "Print the same JSON the MCP `fixes` tool returns"),
  "",
  "fixes apply:",
  opt("--repo <path>", "The site repository root (required)"),
  opt("--only <a,b>", "Only these fix keys"),
  opt("--dir <name>", "Folder for snippets and PULL_REQUEST.md (default saylent-fixes)"),
  opt("--branch <name>", "Branch to create (default saylent/fixes-<date>)"),
  opt("--dry-run", "Show the diff and stop"),
  opt("--yes", "Apply without the confirmation prompt"),
  HELP_OPTION,
])}`;

const resolveBundlePath = (p: string): string => {
  const abs = path.resolve(p);
  return existsSync(abs) && statSync(abs).isDirectory() ? path.join(abs, "run.json") : abs;
};

export function formatFixes(bundle: RunBundleV1, fixKey?: string): string {
  const payload = fixesPayload(bundle, { fixKey });
  const out: string[] = [`\nSaylent ${glyph("sep")} fixes ${glyph("sep")} ${bundle.brand_model.brand}\n`];
  for (const f of payload.fixes) {
    out.push(`  ${String(f.rank).padStart(2)}. ${f.title}`);
    out.push(`      ${f.fix_key} ${glyph("sep")} effort ${f.effort} ${glyph("sep")} weight ${f.weight} ${glyph("sep")} ${f.engines.map(engineLabel).join(", ")}${f.applies_to === "site" ? ` ${glyph("sep")} fixes apply can write it` : ""}`);
    for (const e of f.evidence.slice(0, fixKey ? 50 : 3)) out.push(`      ${glyph("dot")} ${e}`);
    if (!fixKey && f.evidence.length > 3) out.push(`      +${f.evidence.length - 3} more (--fix ${f.fix_key})`);
    if (fixKey && f.artifact) out.push("", f.artifact.trim());
  }
  if (!fixKey) out.push("", `  One fix in full: saylent fixes <run.json> --fix <key> ${glyph("sep")} into your repo: saylent fixes apply <run.json> --repo <path>`);
  return `${out.join("\n")}\n`;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

async function runApply(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      repo: { type: "string" },
      only: { type: "string" },
      dir: { type: "string" },
      branch: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
    },
  });
  if (!positionals[0]) {
    process.stderr.write(`Missing <run.json>.\n\n${HELP}\n`);
    return 1;
  }
  if (!values.repo) {
    process.stderr.write(`\n  fixes apply needs --repo <path>, your site repository's root.\n`);
    return 1;
  }
  if (values.dir && (path.isAbsolute(values.dir) || values.dir.split(/[\\/]/).includes(".."))) {
    process.stderr.write(`\n  --dir ${values.dir}: a folder name inside the repository.\n`);
    return 1;
  }
  const bundlePath = resolveBundlePath(positionals[0]);
  const bundle = await loadBundleFileAsync(bundlePath);
  const { root, branch: baseBranch } = checkRepo(values.repo);
  const reportPath = existsSync(path.join(path.dirname(bundlePath), "report.html")) ? path.join(path.dirname(bundlePath), "report.html") : null;
  const plan = planFixApply(bundle, repoView(root), {
    dir: values.dir,
    only: values.only?.split(",").map((s) => s.trim()).filter(Boolean),
    reportPath,
  });

  process.stdout.write(`\nSaylent ${glyph("sep")} fixes apply ${glyph("sep")} ${bundle.brand_model.brand} ${glyph("sep")} ${root}\n\n`);
  if (plan.applied.length === 0) {
    process.stdout.write("  Nothing to write: this run drafted no robots.txt or JSON-LD change for the site.\n");
    for (const n of plan.notApplied) process.stdout.write(`    ${glyph("dot")} ${n.title}: ${n.reason}\n`);
    return 0;
  }
  for (const a of plan.applied) process.stdout.write(`  ${glyph("dot")} ${a.title}\n      ${a.files.join(", ")}\n`);
  if (plan.notApplied.length) process.stdout.write(`\n  Not applied (${plan.notApplied.length}): ${plan.notApplied.map((n) => n.fix_key).join(", ")}; listed in ${plan.prPath}\n`);
  if (plan.review.length) {
    process.stdout.write("\n  Check before merging:\n");
    for (const r of plan.review) process.stdout.write(`    ${glyph("dot")} ${r}\n`);
  }
  process.stdout.write(`\n${planDiff(plan)}\n\n`);
  if (values["dry-run"]) {
    process.stdout.write("  Dry run: nothing was written.\n");
    return 0;
  }
  const branch = values.branch ?? freeBranchName(root, `saylent/fixes-${new Date().toISOString().slice(0, 10)}`);
  if (!values.yes) {
    if (!process.stdin.isTTY) {
      process.stderr.write("  Not a terminal, so there is no one to ask: pass --yes to apply without the prompt.\n");
      return 1;
    }
    const ok = await confirm(`  Create branch ${branch} in ${root}, write ${plan.files.length} file${plan.files.length === 1 ? "" : "s"} and commit? [y/N] `);
    if (!ok) {
      process.stdout.write("  Nothing was written.\n");
      return 0;
    }
  }
  const commit = applyPlan(root, plan, branch);
  const q = (s: string) => (/^[\w./@:-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, "\\$1")}"`);
  const title = `AI visibility fixes for ${bundle.brand_model.domain || bundle.run.brand.domain} (drafted by Saylent)`;
  process.stdout.write(
    [
      `  Committed ${commit} on ${branch} (from ${baseBranch}). Nothing was pushed.`,
      "",
      "  When you have reviewed it:",
      `    cd ${q(root)}`,
      `    git push -u origin ${q(branch)}`,
      `    gh pr create --base ${q(baseBranch)} --head ${q(branch)} --title ${q(title)} --body-file ${q(plan.prPath)}`,
      "",
      `  To drop it: git switch ${q(baseBranch)} && git branch -D ${q(branch)}`,
      "",
    ].join("\n"),
  );
  return 0;
}

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  try {
    if (argv[0] === "apply") return await runApply(argv.slice(1));
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { fix: { type: "string" }, json: { type: "boolean", default: false } },
    });
    if (!positionals[0]) {
      process.stderr.write(`Missing <run.json>.\n\n${HELP}\n`);
      return 1;
    }
    const bundle = await loadBundleFileAsync(resolveBundlePath(positionals[0]));
    if (values.json) process.stdout.write(`${JSON.stringify(fixesPayload(bundle, { fixKey: values.fix }), null, 2)}\n`);
    else process.stdout.write(formatFixes(bundle, values.fix));
    return 0;
  } catch (e) {
    process.stderr.write(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}
