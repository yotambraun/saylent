// The preflight block: keys/engines/profile/output table, a cost estimate BEFORE
// the spend, the "Run it? [Y/n]" gate (skipped by --yes), and the local spend
// ledger honoring DAILY_SPEND_CAP_USD / --max-usd.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { ResolvedRoles, ResolvedSampling, ResolvedSkip } from "@saylent/engine";
import { type KeyMap, saylentHome } from "./keys";
import type { EngineModule } from "./engine-loader";
import { glyph } from "./glyphs";

export type ProfileName = "full" | "smoke";
export type Engine = "chatgpt" | "claude" | "gemini" | "perplexity";

/** The preflight's Judge line. Two judgment keys ⇒
 *  cross-family (an answer is judged by the OTHER family, which is the
 *  self-preference control); one key ⇒ single-family, and the line names the
 *  exact env var that would restore cross-family judging. */
export function formatJudgeMode(keys: KeyMap): string {
  const openai = Boolean(keys.openai);
  const anthropic = Boolean(keys.anthropic);
  if (openai && anthropic) return `cross-family (OpenAI ${glyph("swap")} Anthropic)`;
  if (openai) return "single-family (OpenAI only; add ANTHROPIC_API_KEY for cross-family)";
  if (anthropic) return "single-family (Anthropic only; add OPENAI_API_KEY for cross-family)";
  return "none (add OPENAI_API_KEY or ANTHROPIC_API_KEY)";
}

/** The preflight names not just the judge MODE but the exact
 *  model(s) doing the judging, so a --judge/--model override or a
 *  saylent.config models block is visible before a cent is spent. Cross-family
 *  ⇒ usually two distinct models (one per family); single-family ⇒ one. */
export function formatJudgeModels(roles: ResolvedRoles): string {
  const models = new Set<string>();
  for (const engine of ["chatgpt", "claude", "gemini", "perplexity"] as const) {
    models.add(roles.roles[`judge:for-${engine}`].model);
  }
  return [...models].join(" / ");
}

export interface CostRange {
  lowUsd: number;
  highUsd: number;
}

/** THE one place the smoke profile's price is written as prose. Every surface
 *  that quotes a smoke price — the MCP tool descriptions, `saylent mcp
 *  --help`, the docs table — reads this string, so three places can never
 *  advertise three different numbers again. The range is what
 *  estimateCostRange() produces for smoke with all four engines; the recorded
 *  figure is what our own published sample run actually cost. */
export const SMOKE_COST_SENTENCE = "about $0.40 to $1.20 with four engines; our recorded runs cost $0.93 and $1.11";

/** The same for `full`, as a plain range (no published run to quote yet). */
export const FULL_COST_SENTENCE = "about $2.50 to $4.00 with four engines";

/** A deliberately approximate range built from the SAME per-answer fallback
 *  rates the engine bills a run with (answer-cost.ts COST_CENTS) plus the
 *  fixed per-role costs (run-audit.ts ROLE_COST_CENTS) — not a simulation of
 *  the adaptive-tiebreak/judge-concurrency logic, just the same inputs the
 *  real run's cost accounting reduces to when every draw is a flat-rate
 *  answer. Good enough for a "should I run this" decision, never precise to
 *  the cent (the real run always states its own final cost).
 *
 *  Samples feature: `opts.sampling` (the RESOLVED run-level samples/tiebreak
 *  — profiles.resolveSampling) replaces the profile's own scoredSamples/
 *  scoredTiebreak when given, so a --samples override visibly raises the
 *  estimate BEFORE a cent is spent. `opts.questions` (a loaded --questions
 *  file's rows) replaces caps.questions when given, so adding/removing rows
 *  is reflected too — the count changes, not the per-question sample math
 *  (still the blended run-level factor; a tighter per-question estimate is
 *  future work, this stays "deliberately approximate" per the note above).
 *
 * `opts.skip.drafts` drops the drafter overhead
 *  entirely (draftArtifacts never runs, so that cost is never spent). `corpus`
 *  and `gates` carry no LLM cost in this estimate either way (buildCorpus/
 *  runDomainChecks are fetches + deterministic checks, not billed roles), so
 *  skipping them doesn't change the number — only the request they save. */
export function estimateCostRange(
  engineMod: Pick<EngineModule, "PROFILES" | "COST_CENTS" | "ROLE_COST_CENTS">,
  profile: ProfileName,
  engines: Engine[],
  opts: {
    sampling?: Pick<ResolvedSampling, "samples" | "tiebreak">;
    questions?: { qtype: string }[];
    skip?: Pick<ResolvedSkip, "drafts">;
  } = {},
): CostRange {
  const { PROFILES, COST_CENTS, ROLE_COST_CENTS } = engineMod;
  const caps = PROFILES[profile];
  const scoredSamples = opts.sampling?.samples ?? caps.scoredSamples;
  const scoredTiebreak = opts.sampling?.tiebreak ?? caps.scoredTiebreak;
  const questionCount = opts.questions?.length ?? caps.questions;
  const rates = engines.map((e) => COST_CENTS[e]);
  const perAnswerLow = rates.length ? Math.min(...rates) : 0;
  const perAnswerHigh = rates.length ? Math.max(...rates) : 0;
  const scoredDrawFactor = scoredSamples + (scoredTiebreak ? 0.5 : 0); // rough: half the scored group needs a tiebreak
  const drawsLow = questionCount * engines.length; // best case: every draw single-sample
  const drawsHigh = questionCount * engines.length * Math.max(1, scoredDrawFactor);
  const answerCentsLow = perAnswerLow * drawsLow;
  const answerCentsHigh = perAnswerHigh * drawsHigh;
  const overheadLow = ROLE_COST_CENTS.brand + ROLE_COST_CENTS.judge * drawsLow * 0.5;
  const draftOverhead = opts.skip?.drafts ? 0 : ROLE_COST_CENTS.drafter * caps.draftTop;
  const overheadHigh = ROLE_COST_CENTS.brand + ROLE_COST_CENTS.judge * drawsHigh + draftOverhead;
  return {
    lowUsd: Math.round(answerCentsLow + overheadLow) / 100,
    highUsd: Math.round(answerCentsHigh + overheadHigh) / 100,
  };
}

// ---------------------------------------------------------------------------
// Samples feature — the operator controls how many times each question is
// asked (run level: --samples / AUDIT_SAMPLES / saylent.config sampling).
// ---------------------------------------------------------------------------

const SAMPLES_SOURCE_LABEL: Record<Exclude<ResolvedSampling["source"], "profile">, string> = {
  flag: "--samples",
  env: "AUDIT_SAMPLES",
  config: "saylent.config sampling",
};

/** Parse + validate `--samples <n>` (1-5). Returns undefined when the flag
 *  wasn't passed; throws a copy-pasteable error on a non-integer or
 *  out-of-range value — never silently ignores a bad override. */
export function parseSamplesFlag(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new Error(`--samples ${raw}: expected a whole number 1-5.`);
  }
  return n;
}

/** The defaults-in-effect line: the resolved sample count, the
 *  tiebreak state, and WHICH layer supplied it (flag/env/config/profile) —
 *  printed by `saylent questions` and `audit --dry-run` before a cent is
 *  spent, so an env var or config change is never a silent surprise.
 *
 *  A profile default NAMES ITS PROFILE ("smoke default", not "profile
 *  default"): `questions` and `audit` used to print the same phrase with two
 *  different numbers because they were quoting two different profiles, and
 *  neither line said which. */
export function formatSamplingLine(resolved: ResolvedSampling, profile?: ProfileName): string {
  const src =
    resolved.source === "profile"
      ? `${profile ?? "profile"} default`
      : SAMPLES_SOURCE_LABEL[resolved.source];
  const tiebreak =
    resolved.samples === 2
      ? resolved.tiebreak
        ? ` ${glyph("sep")} tiebreak on disagreement (n=2)`
        : ` ${glyph("sep")} tiebreak off`
      : "";
  return `${resolved.samples}x scored questions (${src})${tiebreak}`;
}

// ---------------------------------------------------------------------------
// stage skips (--skip / AUDIT_SKIP /
// saylent.config skip). formatSkipLine is the preflight line; the resolution
// itself (flag > env > config precedence) lives in profiles.ts resolveSkip
// so the CLI and any future embedder resolve it identically.
// ---------------------------------------------------------------------------

/** "Skipping  drafts, gates (by request)" — printed only when at least one
 *  stage is actually skipped; null (no line) otherwise. Order is always
 *  drafts, corpus, gates regardless of how the operator listed them. */
export function formatSkipLine(skip: Pick<ResolvedSkip, "drafts" | "corpus" | "gates">): string | null {
  const on = (["drafts", "corpus", "gates"] as const).filter((k) => skip[k]);
  if (on.length === 0) return null;
  return `Skipping  ${on.join(", ")} (by request)`;
}

export function formatCostRange(range: CostRange): string {
  const fmt = (n: number) => (n < 0.01 ? "< $0.01" : `$${n.toFixed(2)}`);
  return `${fmt(range.lowUsd)}${glyph("ndash")}${fmt(range.highUsd)}`; // en dash: numeric ranges are the one exception to the no-em-dash rule
}

// ---------------------------------------------------------------------------
// spend ledger — ~/.saylent/spend.json, keyed by UTC date "YYYY-MM-DD"
// ---------------------------------------------------------------------------

export function spendFilePath(): string {
  return path.join(saylentHome(), "spend.json");
}

export function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function readSpendLedger(): Record<string, number> {
  const file = spendFilePath();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function todaySpendUsd(now: Date = new Date()): number {
  return readSpendLedger()[todayKey(now)] ?? 0;
}

/** Add `amountUsd` to today's running total. Called after a run finishes with
 *  its REAL cost (never the estimate) so the cap tracks actual spend. */
export function recordSpend(amountUsd: number, now: Date = new Date()): void {
  const ledger = readSpendLedger();
  const key = todayKey(now);
  ledger[key] = Math.round(((ledger[key] ?? 0) + amountUsd) * 100) / 100;
  mkdirSync(saylentHome(), { recursive: true });
  writeFileSync(spendFilePath(), `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

/** The default daily ceiling on provider spend, in USD. Deliberately the same
 *  number the app's own DAILY_SPEND_CAP_USD defaults to (src/lib/limits.ts): one
 *  cap that means the same thing whether a run is started from the CLI or from a
 *  self-hosted deployment. DAILY_SPEND_CAP_USD overrides it. */
export const DEFAULT_DAILY_CAP_USD = 20;

export interface SpendCheck {
  ok: boolean;
  reason?: string;
}

/** Refuse to start a run whose HIGH estimate would push today's ledger past
 *  the daily cap, or past --max-usd when the caller passed one. */
export function checkSpendCap(
  estimateHighUsd: number,
  opts: { dailyCapUsd?: number; maxUsd?: number; now?: Date } = {},
): SpendCheck {
  const dailyCap = opts.dailyCapUsd ?? envDailyCap() ?? DEFAULT_DAILY_CAP_USD;
  const spent = todaySpendUsd(opts.now);
  if (spent + estimateHighUsd > dailyCap) {
    return {
      ok: false,
      reason: `Daily spend cap $${dailyCap.toFixed(2)} would be exceeded (already spent $${spent.toFixed(2)} today, this run could cost up to $${estimateHighUsd.toFixed(2)}). Raise DAILY_SPEND_CAP_USD or wait until tomorrow.`,
    };
  }
  if (opts.maxUsd !== undefined && estimateHighUsd > opts.maxUsd) {
    return {
      ok: false,
      reason: `--max-usd ${opts.maxUsd.toFixed(2)} is below the high estimate $${estimateHighUsd.toFixed(2)}. Raise --max-usd or pick a cheaper profile.`,
    };
  }
  return { ok: true };
}

function envDailyCap(): number | undefined {
  const raw = process.env.DAILY_SPEND_CAP_USD?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// ---------------------------------------------------------------------------
// "Run it? [Y/n]" gate
// ---------------------------------------------------------------------------

export interface ConfirmIO {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** Whether `input` is an interactive terminal. Left undefined by a caller
   *  that supplies its own scripted stream (tests, an embedding host): such a
   *  stream is trusted to answer, so the guard below only fires on a real,
   *  non-interactive process.stdin. */
  isTTY?: boolean;
}

const REAL_IO: ConfirmIO = { input: process.stdin, output: process.stdout };

/** The message printed (and the reason for exit code 1) when there is no
 *  terminal to ask. Exported so the CLI and its test name the same string. */
export const NOT_A_TERMINAL_MESSAGE = "Not a terminal. Re-run with --yes.";

/** Refused because there is nobody to answer "[Y/n]". Thrown rather than
 *  returned so no caller can mistake it for a "no". */
export class NotATerminalError extends Error {
  constructor() {
    super(NOT_A_TERMINAL_MESSAGE);
    this.name = "NotATerminalError";
  }
}

function isInteractive(io: ConfirmIO): boolean {
  if (typeof io.isTTY === "boolean") return io.isTTY;
  if (io.input === process.stdin) return Boolean(process.stdin.isTTY);
  return true;
}

/** Y/n on empty answer defaults to yes (matches the "[Y/n]" convention).
 *
 *  With no terminal on the other end (`saylent audit ... < /dev/null`, a cron
 *  job, a CI step) readline resolves the question with an immediate EOF — the
 *  old behaviour read that empty line as "yes" and spent money nobody agreed
 *  to, or, with a stdin that never closes, hung forever. So a non-TTY stdin
 *  without `--yes` is refused instead. */
export function confirmRun(io: ConfirmIO = REAL_IO): Promise<boolean> {
  if (!isInteractive(io)) return Promise.reject(new NotATerminalError());
  return new Promise((resolve) => {
    const rl = createInterface({ input: io.input, output: io.output });
    rl.question("  Run it? [Y/n] ", (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === "" || a === "y" || a === "yes");
    });
  });
}
