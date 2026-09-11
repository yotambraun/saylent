// The Action's logic, as a plain importable module — GitHub sets one INPUT_<NAME> env
// var per input (upper-cased, spaces -> underscores) before entry.ts (the real
// action.yml `runs.main` / esbuild entry point) calls runAction() below;
// @actions/core reads those. A fast, $0, no-LLM, no-keys check
// (robots.txt per bot class, a live per-UA probe, JSON-LD, meta), badge SVG written
// into the repo (not a hosted service). Every check's LOGIC lives in @saylent/engine -
// run.ts calls it exactly like `saylent gate-check` does
// (packages/cli/src/commands/gate-check.ts, out of this file's scope to import from
// directly, so the same construction is mirrored here rather than reimplemented). This
// file only wires Action inputs to that call, and the GateResult it returns to Action
// outputs: files, the job summary, `core.setOutput`, and the exit code (via `fail_on`
// - see fail-on.ts).
//
// Submodule imports (not the "@saylent/engine" barrel) so this bundle never pulls in
// the LLM adapters (openai, @anthropic-ai/sdk, @google/genai) a gate check has no use
// for - same reasoning as packages/cli/src/engine-loader.ts's loadGateCheckEngine().
//
// No top-level side effects here (deliberately) — importing this module (main.test.ts)
// runs nothing; only entry.ts invoking runAction() does.
import * as core from "@actions/core";
import { crawlSite } from "@saylent/engine/crawl";
import { BOT_REGISTRY, runDomainChecks } from "@saylent/engine/domainChecks";
import { MemoryDbWriter } from "@saylent/engine/memory-writer";
import { safeFetch } from "@saylent/engine/util";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { renderBadgeSvg } from "./badge";
import { DEFAULT_FAIL_ON, parseFailOn, shouldFailJob } from "./fail-on";
import { computeGateResult } from "./gate-result";
import type { GateCheckEngine } from "./run";
import { runGateCheck } from "./run";
import { renderSummaryMarkdown } from "./summary";
import type { GateResult } from "./types";

const engineMod: GateCheckEngine = { crawlSite, runDomainChecks, MemoryDbWriter, BOT_REGISTRY, safeFetch };

/** core.getBooleanInput() throws on an empty/missing input rather than falling back -
 *  fine when GitHub has already applied action.yml's `default:`, but a direct local
 *  invocation (this file's own DONE-CHECK, or a hand-run smoke test) may not set the
 *  env var at all. Apply the same default action.yml declares before delegating. */
export function booleanInput(name: string, def: boolean): boolean {
  return core.getInput(name) === "" ? def : core.getBooleanInput(name);
}

/** TEST-ONLY escape hatch (never set by action.yml or action-selftest.yml — a real
 *  run always crawls the real domain over the network). Lets this whole file be
 *  exercised - inputs in, badge/summary/outputs/exit-code out - in a sandbox with no
 *  network access: `SAYLENT_ACTION_FAKE_RESULT=1 INPUT_DOMAIN=example.com node
 *  dist/index.js`. Fixed, deterministic DomainCheck-shaped rows reduced through the
 *  exact same computeGateResult() a real run uses. */
/** P4 security review #21: `badge_path` is a workflow-author-controlled Action
 *  input (`with: badge_path: ...` in a consumer's own workflow yaml). Resolves
 *  it against `workspaceRoot` and returns the absolute target ONLY when that
 *  stays inside the workspace; returns null for anything that escapes it
 *  (`../../etc/x`, an absolute path elsewhere, `badge_path: .` itself) so the
 *  caller can fail the job instead of writing outside the checkout. Exported
 *  for the test. */
export function resolveBadgePath(workspaceRoot: string, badgePathInput: string): string | null {
  const root = resolve(workspaceRoot);
  const candidate = resolve(root, badgePathInput);
  if (candidate === root) return null; // must name a file under the root, not the root itself
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return candidate;
}

export function fakeGateResult(domain: string): GateResult {
  const checks = [
    { check: "robots: GPTBot", status: "warn" as const, detail: "blocked — feeds future OpenAI model weights; blocking is a legitimate choice" },
    { check: "robots: ClaudeBot", status: "pass" as const, detail: "allowed" },
    { check: "robots: OAI-SearchBot", status: "pass" as const, detail: "allowed" },
    { check: "robots: Claude-SearchBot", status: "pass" as const, detail: "allowed" },
    { check: "robots: PerplexityBot", status: "pass" as const, detail: "allowed" },
    { check: "robots: Bingbot", status: "pass" as const, detail: "allowed" },
    { check: "robots: ChatGPT-User", status: "pass" as const, detail: "allowed" },
    { check: "robots: Claude-User", status: "pass" as const, detail: "allowed" },
    { check: "robots: Perplexity-User", status: "pass" as const, detail: "allowed" },
    { check: "live fetch as OAI-SearchBot", status: "pass" as const, detail: "HTTP 200" },
    { check: "live fetch as ChatGPT-User", status: "pass" as const, detail: "HTTP 200" },
    { check: "live fetch as Claude-SearchBot", status: "pass" as const, detail: "HTTP 200" },
    { check: "live fetch as PerplexityBot", status: "pass" as const, detail: "HTTP 200" },
    { check: "live fetch as GPTBot", status: "pass" as const, detail: "HTTP 200" },
    { check: "live fetch as ClaudeBot", status: "pass" as const, detail: "HTTP 200" },
    { check: "JSON-LD Organization", status: "pass" as const, detail: "present" },
    { check: "JSON-LD Product", status: "warn" as const, detail: "No Product schema found on crawled pages." },
    { check: "JSON-LD FAQPage", status: "warn" as const, detail: "No FAQPage schema found on crawled pages." },
    { check: "content coverage", status: "pass" as const, detail: "Every non-branded question has a matching page (threshold 1)." },
    { check: "homepage entity clarity", status: "warn" as const, detail: "SAYLENT_ACTION_FAKE_RESULT=1 — no crawl performed." },
    { check: "freshness", status: "pass" as const, detail: "No page titles carry years older than last year." },
  ];
  return computeGateResult(checks, BOT_REGISTRY, domain, 0);
}

/** The whole Action, as a plain async function — no top-level side effects on
 *  import, so this module stays importable from tests (main.test.ts) without
 *  running anything. entry.ts (the real esbuild/action.yml entry point) is the
 *  only place that calls this and reacts to its rejection. */
export async function runAction(): Promise<void> {
  const domain = core.getInput("domain", { required: true });
  const failOn = parseFailOn(core.getInput("fail_on") || DEFAULT_FAIL_ON);
  const badgePathInput = core.getInput("badge_path") || ".github/badges/ai-access.svg";
  const writeBadge = booleanInput("write_badge", true);
  const siteRoot = core.getInput("site_root") || undefined;

  const result = process.env.SAYLENT_ACTION_FAKE_RESULT
    ? fakeGateResult(domain)
    : await runGateCheck(engineMod, domain, { siteRoot });

  const summary = renderSummaryMarkdown(result, failOn);
  core.setOutput("result", result.overall);
  core.setOutput("summary", summary);

  if (process.env.GITHUB_STEP_SUMMARY) {
    await core.summary.addRaw(summary).write();
  } else {
    // Local/DONE-CHECK invocation with no job summary file — print instead of
    // throwing (core.summary.write() throws when $GITHUB_STEP_SUMMARY is unset).
    core.info(summary);
  }

  if (writeBadge) {
    const workspaceRoot = process.env.GITHUB_WORKSPACE || process.cwd();
    const badgePath = resolveBadgePath(workspaceRoot, badgePathInput);
    if (!badgePath) {
      core.setFailed(
        `badge_path "${badgePathInput}" resolves outside the workspace (${workspaceRoot}). Use a path inside the checkout.`,
      );
      return;
    }
    mkdirSync(dirname(badgePath), { recursive: true });
    writeFileSync(badgePath, renderBadgeSvg(result.overall));
    core.info(`Badge written to ${badgePath}`);
  }

  if (shouldFailJob(result.classes, failOn)) {
    core.setFailed(
      `AI access gate failed: a bot class in fail_on (${[...failOn].join(", ") || "none"}) is blocked. See the job summary.`,
    );
    return;
  }
  core.info(`AI access gate: ${result.overall} (${domain})`);
}
