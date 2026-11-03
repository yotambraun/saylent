// The drafted fixes of a run, and `saylent fixes apply`: writing the
// site-side ones into a local site repository on a new branch.
//
// What is written, and only this:
//   * robots.txt groups from an AI-crawler-access fix: appended to the repo's
//     own robots.txt, or replacing a group that names only that one bot; a
//     group shared with other bots is left alone and listed for review.
//   * JSON-LD blocks from a structured-data fix: each one a snippet file under
//     the fixes folder, with the artifact's own "where it goes" note. Saylent
//     never edits a template: it cannot know the site's framework.
//   * the pull-request description (receipts, review checklist, what was not
//     applied, how to verify) in the same folder.
// Saylent drafts no llms.txt today, so nothing is written for one.
//
// SAFETY: every path is relative to the repo root and checked against the
// real path of that root after symlinks, an existing symlink is never written
// through, the work tree must be clean, the change lands on a NEW branch and
// is committed locally. Nothing is pushed: the caller prints the commands.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RunBundleV1 } from "@saylent/engine/bundle";
import { engineLabel } from "@saylent/engine/surfaces";

// ---------------------------------------------------------------------------
// the fixes payload (CLI `saylent fixes --json`, MCP `fixes`)
// ---------------------------------------------------------------------------

export interface FixSummary {
  rank: number;
  fix_key: string;
  title: string;
  factor: string;
  weight: number;
  effort: string;
  time_to_impact: string | null;
  engines: string[];
  evidence: string[];
  has_artifact: boolean;
  /** where a fix lands: "site" (robots.txt or JSON-LD Saylent can write into
   *  a repo with `fixes apply`) or "other" (outreach, content, PR work) */
  applies_to: "site" | "other";
  artifact?: string;
}

const hasText = (s: string | undefined): s is string => typeof s === "string" && s.trim().length > 0;

export function fixesPayload(bundle: RunBundleV1, opts: { fixKey?: string; withArtifacts?: boolean } = {}) {
  const all: FixSummary[] = bundle.fixes.map((f, i) => {
    const site = robotsGroupsFrom(f.artifact ?? "").length > 0 || jsonLdBlocksFrom(f.artifact ?? "").length > 0;
    return {
      rank: i + 1,
      fix_key: f.fixKey,
      title: f.title,
      factor: f.factor,
      weight: f.weight,
      effort: f.effort,
      time_to_impact: (f as { timeToImpact?: string }).timeToImpact ?? null,
      engines: [...(f.engines ?? [])],
      evidence: [...(f.evidence ?? [])],
      has_artifact: hasText(f.artifact),
      applies_to: site ? "site" : "other",
      ...(opts.withArtifacts || opts.fixKey ? { artifact: f.artifact ?? "" } : {}),
    };
  });
  if (opts.fixKey) {
    const one = all.find((f) => f.fix_key === opts.fixKey);
    if (!one) throw new Error(`No fix "${opts.fixKey}" in this run. Fixes: ${all.map((f) => f.fix_key).join(", ")}.`);
    return { brand: bundle.brand_model.brand, domain: bundle.brand_model.domain, run_id: bundle.run.id, fixes: [one], cost_usd: 0 };
  }
  return {
    brand: bundle.brand_model.brand,
    domain: bundle.brand_model.domain,
    run_id: bundle.run.id,
    measured_at: bundle.run.finished_at ?? bundle.run.started_at,
    fixes: all,
    site_fixes: all.filter((f) => f.applies_to === "site").map((f) => f.fix_key),
    note: "Evidence lines are the receipts the diagnosis recorded. Drafts are drafts: values marked TODO-VERIFY must be checked before anything ships.",
    cost_usd: 0,
  };
}

// ---------------------------------------------------------------------------
// artifact parsing
// ---------------------------------------------------------------------------

interface Fence {
  info: string;
  body: string;
  /** the text between the previous fence (or the start) and this one */
  before: string;
}

/** Top-level fenced code blocks, in order. A fence closes at the first line
 *  that is only ``` (the drafter's nested fences sit inside prose). */
export function fencesOf(md: string): Fence[] {
  const out: Fence[] = [];
  const lines = md.split(/\r?\n/);
  let i = 0;
  let prose: string[] = [];
  while (i < lines.length) {
    const open = /^\s*```\s*([\w.+-]*)\s*$/.exec(lines[i]);
    if (!open) {
      prose.push(lines[i]);
      i++;
      continue;
    }
    const body: string[] = [];
    i++;
    while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
    i++;
    out.push({ info: open[1].toLowerCase(), body: body.join("\n"), before: prose.join("\n") });
    prose = [];
  }
  return out;
}

export interface RobotsGroup {
  agents: string[];
  rules: string[];
}

const ROBOTS_LINE = /^\s*(user-agent|allow|disallow|sitemap|crawl-delay)\s*:\s*(.*)$/i;

/** robots.txt groups: consecutive User-agent lines, then their rules. */
export function parseRobots(text: string): { groups: (RobotsGroup & { start: number; end: number })[]; lines: string[] } {
  const lines = text.split(/\r?\n/);
  const groups: (RobotsGroup & { start: number; end: number })[] = [];
  let cur: (RobotsGroup & { start: number; end: number }) | null = null;
  lines.forEach((raw, idx) => {
    const m = ROBOTS_LINE.exec(raw.replace(/#.*$/, ""));
    if (!m) return;
    const field = m[1].toLowerCase();
    if (field === "sitemap") return;
    if (field === "user-agent") {
      if (!cur || cur.rules.length > 0) {
        cur = { agents: [], rules: [], start: idx, end: idx };
        groups.push(cur);
      }
      cur.agents.push(m[2].trim());
      cur.end = idx;
      return;
    }
    if (cur) {
      cur.rules.push(`${m[1].charAt(0).toUpperCase()}${m[1].slice(1).toLowerCase()}: ${m[2].trim()}`);
      cur.end = idx;
    }
  });
  return { groups, lines };
}

/** The robots.txt groups a fix drafted (uncommented directive lines only). */
export function robotsGroupsFrom(artifact: string): RobotsGroup[] {
  for (const f of fencesOf(artifact)) {
    if (!/^\s*user-agent\s*:/im.test(f.body.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n"))) continue;
    if (/\b(curl|grep)\b/.test(f.body)) continue;
    const kept = f.body.split("\n").filter((l) => ROBOTS_LINE.test(l) && !l.trim().startsWith("#"));
    const { groups } = parseRobots(kept.join("\n"));
    if (groups.length) return groups.map(({ agents, rules }) => ({ agents, rules }));
  }
  return [];
}

export interface JsonLdBlock {
  type: string;
  snippet: string;
  /** the artifact's own placement note, e.g. "add to your homepage <head>" */
  where: string | null;
  todoVerify: number;
}

/** JSON-LD script blocks a fix drafted, each validated as JSON. */
export function jsonLdBlocksFrom(artifact: string): JsonLdBlock[] {
  const out: JsonLdBlock[] = [];
  for (const f of fencesOf(artifact)) {
    const m = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i.exec(f.body);
    if (!m) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const t = (parsed as { "@type"?: unknown })["@type"];
    const type = typeof t === "string" ? t : Array.isArray(t) && typeof t[0] === "string" ? t[0] : "Thing";
    const lastLine = f.before.trim().split("\n").pop() ?? "";
    const where = /\(([^)]*)\)/.exec(lastLine)?.[1]?.trim() ?? null;
    out.push({ type, snippet: f.body.trim(), where, todoVerify: (f.body.match(/TODO-VERIFY/g) ?? []).length });
  }
  return out;
}

// ---------------------------------------------------------------------------
// the plan (pure: reads the repo through `readFile`, writes nothing)
// ---------------------------------------------------------------------------

export interface PlannedFile {
  path: string;
  kind: "create" | "update";
  before: string | null;
  after: string;
  fixKeys: string[];
}

export interface FixPlan {
  files: PlannedFile[];
  review: string[];
  notApplied: { fix_key: string; title: string; reason: string }[];
  applied: { fix_key: string; title: string; files: string[] }[];
  prPath: string;
  prBody: string;
  commitMessage: string;
}

export const ROBOTS_CANDIDATES = ["public/robots.txt", "static/robots.txt", "robots.txt", "src/robots.txt"];
const ROBOTS_GENERATORS = ["app/robots.ts", "app/robots.js", "src/app/robots.ts", "src/app/robots.js", "src/pages/robots.txt.ts", "pages/robots.txt.ts"];

export interface RepoView {
  exists: (rel: string) => boolean;
  read: (rel: string) => string;
}

function applyRobots(existing: string | null, drafted: RobotsGroup[], header: string, review: string[]): string | null {
  const text = existing ?? "";
  const { groups, lines } = parseRobots(text);
  const out = [...lines];
  const appended: string[] = [];
  let changed = false;
  // replace from the bottom so earlier indexes stay valid
  const replacements: { start: number; end: number; lines: string[] }[] = [];
  for (const g of drafted) {
    for (const agent of g.agents) {
      const hit = groups.find((x) => x.agents.some((a) => a.toLowerCase() === agent.toLowerCase()));
      if (!hit) {
        appended.push(`User-agent: ${agent}`, ...g.rules, "");
        changed = true;
        continue;
      }
      const same = hit.rules.map((r) => r.toLowerCase()).join("\n") === g.rules.map((r) => r.toLowerCase()).join("\n");
      if (same) continue;
      if (hit.agents.length === 1) {
        replacements.push({ start: hit.start, end: hit.end, lines: [`User-agent: ${hit.agents[0]}`, ...g.rules] });
        changed = true;
      } else {
        review.push(
          `robots.txt: the group for ${hit.agents.join(", ")} (line ${hit.start + 1}) is shared with other bots, so it was left as is. The draft for ${agent} is: ${g.rules.join("; ")}.`,
        );
      }
    }
  }
  if (!changed) return null;
  for (const r of replacements.sort((a, b) => b.start - a.start)) out.splice(r.start, r.end - r.start + 1, ...r.lines);
  let body = out.join("\n").replace(/\s*$/, "");
  if (appended.length) body = `${body}${body ? "\n\n" : ""}${header}\n${appended.join("\n")}`;
  return `${body.replace(/\s*$/, "")}\n`;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "block";

export function planFixApply(
  bundle: RunBundleV1,
  repo: RepoView,
  opts: { dir?: string; only?: string[]; now?: Date; reportPath?: string | null } = {},
): FixPlan {
  const dir = (opts.dir ?? "saylent-fixes").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const date = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const files = new Map<string, PlannedFile>();
  const review: string[] = [];
  const notApplied: FixPlan["notApplied"] = [];
  const applied: FixPlan["applied"] = [];
  const domain = bundle.brand_model.domain || bundle.run.brand.domain;
  const fixes = bundle.fixes.filter((f) => !opts.only?.length || opts.only.includes(f.fixKey));
  if (opts.only?.length) {
    const missing = opts.only.filter((k) => !bundle.fixes.some((f) => f.fixKey === k));
    if (missing.length) throw new Error(`No fix ${missing.map((k) => `"${k}"`).join(", ")} in this run. Fixes: ${bundle.fixes.map((f) => f.fixKey).join(", ")}.`);
  }

  for (const fix of fixes) {
    const artifact = fix.artifact ?? "";
    const robots = robotsGroupsFrom(artifact);
    const blocks = jsonLdBlocksFrom(artifact);
    const touched: string[] = [];
    if (robots.length) {
      const target = ROBOTS_CANDIDATES.find((c) => repo.exists(c));
      const generator = ROBOTS_GENERATORS.find((c) => repo.exists(c));
      const header = `# AI answer-engine crawlers: drafted by Saylent from run ${bundle.run.id.slice(0, 8)} (${date}). Review before merging.`;
      if (!target && generator) {
        const rel = `${dir}/robots.txt`;
        files.set(rel, { path: rel, kind: "create", before: null, after: applyRobots(null, robots, header, review) ?? "", fixKeys: [fix.fixKey] });
        review.push(`robots.txt is generated by ${generator}, so the drafted rules are in ${rel}: add them to the generator by hand.`);
        touched.push(rel);
      } else {
        const rel = target ?? (repo.exists("public") ? "public/robots.txt" : repo.exists("static") ? "static/robots.txt" : "robots.txt");
        const prev = files.get(rel)?.after ?? (target ? repo.read(rel) : null);
        const next = applyRobots(prev, robots, header, review);
        if (next !== null) {
          files.set(rel, { path: rel, kind: target ? "update" : "create", before: target ? repo.read(rel) : null, after: next, fixKeys: [...(files.get(rel)?.fixKeys ?? []), fix.fixKey] });
          touched.push(rel);
          if (!target) review.push(`No robots.txt was found in the repo, so ${rel} was created. Move it if your site serves static files from another folder.`);
        } else {
          review.push(`robots.txt already carries the drafted rules for ${robots.flatMap((g) => g.agents).join(", ")}; if a bot is still refused, the block is in a CDN or firewall rule, not robots.txt.`);
        }
      }
    }
    if (blocks.length) {
      const seen = new Map<string, number>();
      for (const b of blocks) {
        const n = (seen.get(b.type) ?? 0) + 1;
        seen.set(b.type, n);
        const rel = `${dir}/jsonld/${slug(b.type)}${n > 1 ? `-${n}` : ""}.html`;
        const note = `<!-- ${b.type} JSON-LD drafted by Saylent for ${domain}${b.where ? `: ${b.where}` : ""}. Fields come from the brand model; check every value before it ships. -->`;
        files.set(rel, { path: rel, kind: repo.exists(rel) ? "update" : "create", before: repo.exists(rel) ? repo.read(rel) : null, after: `${note}\n${b.snippet}\n`, fixKeys: [fix.fixKey] });
        touched.push(rel);
        if (b.todoVerify) review.push(`${rel}: ${b.todoVerify} value${b.todoVerify === 1 ? "" : "s"} marked TODO-VERIFY. Replace with a real, sourced value or delete the field.`);
      }
    }
    if (touched.length) applied.push({ fix_key: fix.fixKey, title: fix.title, files: touched });
    else
      notApplied.push({
        fix_key: fix.fixKey,
        title: fix.title,
        reason: hasText(artifact) ? "not a site file change (outreach, content or a page edit)" : "no drafted artifact",
      });
  }

  const prPath = `${dir}/PULL_REQUEST.md`;
  const prBody = prDescription(bundle, { applied, notApplied, review, date, reportPath: opts.reportPath ?? null, prPath });
  if (applied.length) files.set(prPath, { path: prPath, kind: repo.exists(prPath) ? "update" : "create", before: repo.exists(prPath) ? repo.read(prPath) : null, after: prBody, fixKeys: [] });
  const commitMessage = [
    `Add AI visibility fixes drafted by Saylent`,
    "",
    ...applied.map((a) => `- ${a.title}`),
    "",
    `From Saylent run ${bundle.run.id} for ${domain} (${(bundle.run.finished_at ?? bundle.run.started_at).slice(0, 10)}). Receipts: ${prPath}.`,
  ].join("\n");
  return { files: [...files.values()], review, notApplied, applied, prPath, prBody, commitMessage };
}

function prDescription(
  bundle: RunBundleV1,
  p: { applied: FixPlan["applied"]; notApplied: FixPlan["notApplied"]; review: string[]; date: string; reportPath: string | null; prPath: string },
): string {
  const domain = bundle.brand_model.domain || bundle.run.brand.domain;
  const measured = (bundle.run.finished_at ?? bundle.run.started_at).slice(0, 10);
  const engines = bundle.run.engines.map(engineLabel).join(", ");
  const o = bundle.scores?.overall;
  const lines: string[] = [
    `# AI visibility fixes for ${domain}`,
    "",
    `Drafted by [Saylent](https://yotambraun.github.io/saylent/) from run \`${bundle.run.id}\` (${bundle.run.profile} profile, measured ${measured}; engines: ${engines}).`,
    o ? `On that run, ${o.recommended} of ${o.answered} scored answers recommended ${bundle.brand_model.brand} and ${o.mentioned} mentioned it.` : "",
    "Saylent measured and drafted; nothing here was checked by a person yet. Review every line before merging.",
    "",
    "## What this branch changes",
    "",
  ];
  for (const a of p.applied) {
    const fix = bundle.fixes.find((f) => f.fixKey === a.fix_key);
    lines.push(`### ${a.title}`, "");
    if (fix?.evidence?.length) {
      lines.push("Receipts (what the run recorded):", "");
      for (const e of fix.evidence) lines.push(`- ${e}`);
      lines.push("");
    }
    if (fix?.engines?.length) lines.push(`Engines: ${fix.engines.map(engineLabel).join(", ")}.`, "");
    lines.push(`Files: ${a.files.map((f) => `\`${f}\``).join(", ")}`, "");
  }
  if (p.review.length) {
    lines.push("## Check before merging", "");
    for (const r of p.review) lines.push(`- [ ] ${r}`);
    lines.push("");
  }
  if (p.notApplied.length) {
    lines.push("## Not in this branch", "");
    for (const n of p.notApplied) lines.push(`- ${n.title} (\`${n.fix_key}\`): ${n.reason}.`);
    lines.push("");
  }
  lines.push(
    "## Verify after deploy",
    "",
    `- \`npx saylent gate-check ${domain}\`: the AI crawler access check again ($0, no keys).`,
    `- \`npx saylent verify <run.json> --dry-run\`, then without \`--dry-run\`: re-asks the same frozen questions and shows what moved (spends your own provider credits). Movement after a fix is correlation, not proof the fix caused it.`,
    "",
    p.reportPath ? "Every receipt in full: the run's report.html, kept on the machine that ran the audit, not in this repo." : "",
  );
  return `${lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim()}\n`;
}

// ---------------------------------------------------------------------------
// diff text
// ---------------------------------------------------------------------------

/** Line diff (LCS) as ' ' / '-' / '+' ops. Files here are small. */
export function lineDiff(before: string[], after: string[]): { op: " " | "-" | "+"; line: string }[] {
  const n = before.length;
  const m = after.length;
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = before[i] === after[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops: { op: " " | "-" | "+"; line: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ op: " ", line: before[i] });
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) ops.push({ op: "-", line: before[i++] });
    else ops.push({ op: "+", line: after[j++] });
  }
  while (i < n) ops.push({ op: "-", line: before[i++] });
  while (j < m) ops.push({ op: "+", line: after[j++] });
  return ops;
}

/** A readable unified-style diff of the plan: whole new files, and the
 *  changed lines of an updated one with three lines of context. */
export function planDiff(plan: FixPlan): string {
  const out: string[] = [];
  for (const f of plan.files) {
    out.push(`--- ${f.before === null ? "/dev/null" : `a/${f.path}`}`, `+++ b/${f.path}`);
    const before = f.before === null ? [] : f.before.replace(/\n$/, "").split("\n");
    const ops = lineDiff(before, f.after.replace(/\n$/, "").split("\n"));
    const near = ops.map((_, k) => ops.slice(Math.max(0, k - 3), k + 4).some((o) => o.op !== " "));
    let gap = true;
    ops.forEach((o, k) => {
      if (!near[k]) {
        gap = true;
        return;
      }
      if (gap) out.push("@@");
      gap = false;
      out.push(`${o.op}${o.line}`);
    });
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// git + filesystem (the only part that writes)
// ---------------------------------------------------------------------------

const git = (repo: string, args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** The repo's real root; refuses anything that is not the top of a git work
 *  tree with at least one commit and no uncommitted changes. */
export function checkRepo(repoArg: string): { root: string; branch: string } {
  const abs = path.resolve(repoArg);
  if (!existsSync(abs)) throw new Error(`${repoArg}: no such directory.`);
  let top: string;
  try {
    top = git(abs, ["rev-parse", "--show-toplevel"]);
  } catch {
    throw new Error(`${repoArg} is not a git repository. fixes apply commits on a new branch, so it needs one.`);
  }
  const root = realpathSync.native(abs);
  if (realpathSync.native(top) !== root) throw new Error(`${repoArg} is inside the repository at ${top}; pass the repository root.`);
  try {
    git(root, ["rev-parse", "--verify", "HEAD"]);
  } catch {
    throw new Error(`${repoArg} has no commits yet; commit once, then run fixes apply.`);
  }
  if (git(root, ["status", "--porcelain"]) !== "") {
    throw new Error(`${repoArg} has uncommitted changes. Commit or stash them first, so the fixes land in a commit of their own.`);
  }
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return { root, branch };
}

export function repoView(root: string): RepoView {
  return {
    exists: (rel) => existsSync(path.join(root, rel)),
    read: (rel) => readFileSync(path.join(root, rel), "utf8"),
  };
}

/** Resolve a planned relative path inside the root, refusing escapes and
 *  symlinks (an existing link, or a parent directory that resolves outside). */
export function safeTarget(root: string, rel: string): string {
  if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) throw new Error(`Refusing to write ${rel}: not a path inside the repository.`);
  const abs = path.join(root, rel);
  if (existsSync(abs) && lstatSync(abs).isSymbolicLink()) throw new Error(`Refusing to write ${rel}: it is a symbolic link.`);
  let parent = path.dirname(abs);
  while (!existsSync(parent)) parent = path.dirname(parent);
  const realParent = realpathSync.native(parent);
  if (realParent !== root && !realParent.startsWith(`${root}${path.sep}`)) throw new Error(`Refusing to write ${rel}: it resolves outside the repository.`);
  return abs;
}

export function freeBranchName(root: string, base: string): string {
  const exists = (b: string) => {
    try {
      git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${b}`]);
      return true;
    } catch {
      return false;
    }
  };
  if (!exists(base)) return base;
  for (let i = 2; i < 100; i++) if (!exists(`${base}-${i}`)) return `${base}-${i}`;
  throw new Error(`Too many branches named ${base}-N; pass --branch.`);
}

/** Create the branch, write the files, commit. Returns the new commit. */
export function applyPlan(root: string, plan: FixPlan, branch: string): string {
  const targets = plan.files.map((f) => ({ f, abs: safeTarget(root, f.path) }));
  git(root, ["switch", "-c", branch]);
  for (const { f, abs } of targets) {
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, f.after);
  }
  git(root, ["add", "--", ...plan.files.map((f) => f.path)]);
  git(root, ["commit", "-q", "-m", plan.commitMessage]);
  return git(root, ["rev-parse", "--short", "HEAD"]);
}
