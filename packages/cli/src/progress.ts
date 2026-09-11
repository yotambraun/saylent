// The numbered stage narration, live counts, elapsed, running cost, per-engine
// failure isolation, and the final Verdict/Band/Report/Verify lines.
//
// What is printed is deliberately limited to what the pipeline actually returns
// at the moment each line prints. runAudit's onStage fires the coarse stage name
// at stage START with only a short caller-supplied detail string; the rich
// per-item detail (page counts, "Asking ChatGPT · 3/8 answered") arrives
// separately via db.setStage, which this module wraps. So: real stage numbers,
// real elapsed times, real running cost, and a real per-engine answered-count
// summary print as each stage completes; per-engine FAILURE (zero ok answers) is
// detected from the finished RunResult and printed as its own line just before
// the verdict rather than inline in the "04 engines" line, because that data
// does not exist yet when the engines line prints.
import { CRAWL_BLOCKED_MARKER, CRAWL_THIN_MARKER } from "@saylent/engine/crawl";
import { answerCents } from "@saylent/engine/answer-cost";
import { mapProviderError } from "./errors";
import { redactKnownSecrets } from "./redact";
import type { Engine, RunResult, RunStage } from "@saylent/engine";
import { glyph } from "./glyphs";

const STAGE_NUMBER: Record<RunStage, number> = {
  crawl: 1,
  "brand-model": 2,
  questions: 3,
  observe: 4,
  judge: 5,
  corpus: 6,
  "domain-checks": 7,
  fixes: 8,
  score: 9,
};

const STAGE_LABEL: Record<RunStage, string> = {
  crawl: "crawl",
  "brand-model": "brand model",
  questions: "questions",
  observe: "engines",
  judge: "judge",
  corpus: "cited pages",
  "domain-checks": "site gates",
  fixes: "fix plan",
  score: "score",
};

const ENGINE_STAGE_PREFIX: Record<string, Engine> = {
  chatgpt: "chatgpt",
  claude: "claude",
  gemini: "gemini",
  perplexity: "perplexity",
};

function parseAskingLabel(label: string): { engine: Engine; done: number; total: number } | null {
  const m = /^Asking (ChatGPT|Claude|Gemini|Perplexity) · (\d+)\/(\d+) answered$/.exec(label);
  if (!m) return null;
  const engine = ENGINE_STAGE_PREFIX[m[1].toLowerCase()];
  if (!engine) return null;
  return { engine, done: Number(m[2]), total: Number(m[3]) };
}

// crawlSite (packages/engine/src/crawl.ts) relays
// a blocked-crawler / thin-site signal through its EXISTING onProgress
// parameter (the same channel run-audit.ts already wraps into
// `db.setStage("Crawling your site · <path> (<n> pages)")`), tagged with one
// of these two markers as the "<path>" segment. No pipeline change needed —
// wrapSetStage already routes every setStage call through onLiveLabel below.
function parseCrawlIssueLabel(label: string): { kind: "blocked" | "thin"; detail: string } | null {
  const m = /^Crawling your site · (.+) \(\d+ pages\)$/.exec(label);
  if (!m) return null;
  const detail = m[1];
  if (detail.startsWith(CRAWL_BLOCKED_MARKER)) return { kind: "blocked", detail };
  if (detail.startsWith(CRAWL_THIN_MARKER)) return { kind: "thin", detail };
  return null;
}

/** "12.4s" under a minute, "4m 22s" over it. The engines stage regularly runs
 *  four minutes; "261.6s" is a number the reader has to do arithmetic on. */
export function fmtElapsed(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  let minutes = Math.floor(seconds / 60);
  let rest = Math.round(seconds - minutes * 60);
  if (rest === 60) {
    minutes += 1;
    rest = 0;
  }
  return `${minutes}m ${rest}s`;
}

function fmtUsd(cents: number): string {
  const usd = cents / 100;
  return usd > 0 && usd < 0.01 ? "< $0.01" : `$${usd.toFixed(2)}`;
}

interface Pending {
  stage: RunStage;
  detail: string;
  startedAt: number;
}

export interface ProgressOptions {
  out?: NodeJS.WritableStream;
  /** clock injection for tests — defaults to Date.now */
  now?: () => number;
  /** whether `out` is an interactive terminal. Defaults to the stream's own
   *  isTTY. A TTY gets ONE line repainted with \r; anything else (CI, a pipe,
   *  a log file) gets whole lines, throttled, so a build log is not 400
   *  near-identical rows. */
  tty?: boolean;
}

/** The internal marker wrapSetStage uses to report a saved answer's REAL cost
 *  back through the same onLabel callback the pipeline already hands us. The
 *  pipeline wires exactly one callback (run.ts) and that file is not this
 *  module's to change, so the cost rides the label channel; a NUL prefix is
 *  something no real stage label can ever be, and Progress strips it before
 *  anything is printed. */
const COST_MARKER = "\u0000cost ";

/** Monkeypatch a DbWriter's setStage so the CLI also sees every fine-grained
 *  live label the app's own UI reads (run-stages.ts). Instance-level (not a
 *  subclass) so it works on any DbWriter shape, including MemoryDbWriter.
 *
 *  `saveAnswer` is wrapped too, when the writer has one: it is the only point
 *  in the pipeline where MEASURED provider usage reaches a DbWriter, so it is
 *  the only honest source for a running-cost figure. The number is computed
 *  with the engine's own answerCents() — the same function the final total is
 *  computed from — so the running figure and the last line can never disagree
 *  about what an answer cost. */
export function wrapSetStage<T extends { setStage(runId: string, label: string): Promise<void> }>(
  writer: T,
  onLabel: (label: string) => void,
): T {
  const original = writer.setStage.bind(writer);
  writer.setStage = async (runId: string, label: string) => {
    onLabel(label);
    return original(runId, label);
  };
  const withSave = writer as T & {
    saveAnswer?: (row: { engine: string; ok: boolean; usage?: unknown }) => Promise<void>;
  };
  if (typeof withSave.saveAnswer === "function") {
    const originalSave = withSave.saveAnswer.bind(withSave);
    withSave.saveAnswer = async (row) => {
      const cents = answerCents(row as Parameters<typeof answerCents>[0]);
      if (cents > 0) onLabel(`${COST_MARKER}${cents}`);
      return originalSave(row);
    };
  }
  return writer;
}

export interface LiveEngineCount {
  engine: Engine;
  done: number;
  total: number;
}

export interface StageLineState {
  /** two-digit stage number, e.g. "04" */
  number: string;
  /** stage label, e.g. "engines" */
  label: string;
  /** the per-engine counts, when this is the engines stage */
  engines?: LiveEngineCount[];
  /** whatever the pipeline said, used when there are no engine counts */
  detail: string;
  elapsedMs: number;
  /** REAL cents spent so far, or null when nothing measured has arrived yet.
   *  Never estimated: a stage whose cost is not known until it ends prints no
   *  figure until it ends. */
  costCents: number | null;
}

/** One narration line — pure, so the shape of the live engines line is
 *  unit-testable without a pipeline:
 *  `04 engines     chatgpt 3/6 · claude 6/6 · ... · 1m 12s · $0.31 so far` */
export function formatStageLine(state: StageLineState): string {
  const detail =
    state.engines && state.engines.length > 0
      ? state.engines.map((e) => `${e.engine} ${e.done}/${e.total}`).join(` ${glyph("sep")} `)
      : state.detail;
  const parts = [`${fmtElapsed(state.elapsedMs)}`];
  if (state.costCents !== null) parts.push(`${fmtUsd(state.costCents)} so far`);
  return `  ${state.number} ${state.label.padEnd(12)}${detail}   ${parts.join(` ${glyph("sep")} `)}`;
}

export class Progress {
  private out: NodeJS.WritableStream;
  private now: () => number;
  private startedAt: number;
  private pending: Pending | null = null;
  private engineCounts = new Map<Engine, { done: number; total: number }>();
  private lines: string[] = [];
  /** F3 — each crawl-issue kind prints at most once per run, whichever
   *  onProgress calls arrive first (a crawl can only be blocked or thin once
   *  in a meaningful way; repeats are noise). */
  private crawlIssuesShown = new Set<"blocked" | "thin">();
  private tty: boolean;
  /** a \r-repainted line is on screen and must be cleared before any whole
   *  line is written over it */
  private transientWidth = 0;
  private lastLiveAt = 0;
  /** REAL cents seen so far (measured provider usage via saveAnswer), or null
   *  while nothing has arrived. Never an estimate. */
  private costCents: number | null = null;

  constructor(opts: ProgressOptions = {}) {
    this.out = opts.out ?? process.stdout;
    this.now = opts.now ?? Date.now;
    this.tty = opts.tty ?? Boolean((this.out as { isTTY?: boolean }).isTTY);
    this.startedAt = this.now();
    this.lastLiveAt = this.startedAt;
  }

  /** How often a NON-TTY stream (CI, a pipe) may repeat the live line. */
  static readonly LIVE_INTERVAL_MS = 15_000;

  write(line: string): void {
    // one choke point: every narration line, every failure sentence
    // and the top-level `fail()` message pass through key redaction before
    // they reach the terminal or the captured `lines` buffer.
    this.clearTransient();
    const safe = redactKnownSecrets(line);
    this.lines.push(safe);
    this.out.write(`${safe}\n`);
  }

  /** Repaint the single live line in place. Same redaction choke point as
   *  write() — a live line is still a line on somebody's screen. Not pushed
   *  into `lines`: it is replaced, not history. */
  private writeTransient(line: string): void {
    const safe = redactKnownSecrets(line);
    const pad = safe.length < this.transientWidth ? " ".repeat(this.transientWidth - safe.length) : "";
    this.out.write(`\r${safe}${pad}`);
    this.transientWidth = safe.length;
  }

  private clearTransient(): void {
    if (this.transientWidth === 0) return;
    this.out.write(`\r${" ".repeat(this.transientWidth)}\r`);
    this.transientWidth = 0;
  }

  header(lines: string[]): void {
    for (const l of lines) this.write(l);
  }

  /** Bound to `deps.onStage` when calling runAudit(). */
  onStage = (stage: RunStage, detail: string): void => {
    if (this.pending?.stage === stage) return; // observe fires once per engine — one combined line
    this.flushPending();
    this.pending = { stage, detail, startedAt: this.now() };
  };

  /** Bound to a wrapped MemoryDbWriter.setStage — the fine-grained live text
   *  the app's own UI reads (run-stages.ts labels). Used here only to build
   *  the per-engine answered-count summary for the "04 engines" line. */
  onLiveLabel = (label: string): void => {
    // The internal cost channel (see wrapSetStage): a measured answer's cents,
    // never printed as a label.
    if (label.startsWith(COST_MARKER)) {
      const cents = Number(label.slice(COST_MARKER.length));
      if (Number.isFinite(cents)) this.costCents = (this.costCents ?? 0) + cents;
      return;
    }
    const parsed = parseAskingLabel(label);
    if (parsed) {
      this.engineCounts.set(parsed.engine, { done: parsed.done, total: parsed.total });
      this.renderLive();
      return;
    }
    // F3 — a blocked-crawler / thin-site notice, printed immediately (not
    // held for the "01 crawl" summary line) since it is a heads-up, not a
    // count.
    const issue = parseCrawlIssueLabel(label);
    if (issue && !this.crawlIssuesShown.has(issue.kind)) {
      this.crawlIssuesShown.add(issue.kind);
      this.write(`  ${issue.detail}`);
    }
  };

  /** The live "04 engines" line, repainted as the per-engine counts arrive.
   *
   *  A TTY gets ONE line rewritten with \r. Anything else gets whole lines,
   *  and only at the rarer of the two cadences the pipeline offers: an engine
   *  finishing (about four times in a run) or fifteen seconds passing — the
   *  engines stage runs for minutes, and a CI log must not carry a row per
   *  answered question.
   *
   *  The running cost is printed ONLY once a measured figure exists (the
   *  pipeline saves answers with real provider usage at the end of the engines
   *  stage), never estimated to fill the column. */
  private renderLive(): void {
    const p = this.pending;
    if (!p || p.stage !== "observe" || this.engineCounts.size === 0) return;
    const line = formatStageLine({
      number: String(STAGE_NUMBER[p.stage]).padStart(2, "0"),
      label: STAGE_LABEL[p.stage],
      engines: [...this.engineCounts.entries()].map(([engine, c]) => ({ engine, ...c })),
      detail: p.detail,
      elapsedMs: this.now() - p.startedAt,
      costCents: this.costCents,
    });
    if (this.tty) {
      this.writeTransient(line);
      return;
    }
    // A 15-second floor between lines, which is the RARER of the two cadences
    // offered ("every 15s" vs "on each engine completion" — four engines can
    // finish inside one second). Nothing is lost by folding a completion into
    // the next line: the line always carries the current counts, so the very
    // next one shows it, and the stage's own closing line shows the final
    // state either way.
    const done = this.now() - this.lastLiveAt >= Progress.LIVE_INTERVAL_MS;
    if (!done) return;
    this.lastLiveAt = this.now();
    this.write(line);
  }

  private flushPending(): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    const n = String(STAGE_NUMBER[p.stage]).padStart(2, "0");
    const label = STAGE_LABEL[p.stage].padEnd(12);
    const engines =
      p.stage === "observe" && this.engineCounts.size > 0
        ? [...this.engineCounts.entries()].map(([engine, c]) => ({ engine, ...c }))
        : undefined;
    const detail = p.stage === "observe" ? this.engineSummary() || p.detail : p.detail;
    // corpus/domain-checks that run-audit.ts
    // skipped by request never actually ran, so an elapsed time next to them
    // would read as a real (near-zero) measurement rather than "nothing
    // happened here". This is the WHOLE detail string for those two stages
    // only — the fixes stage's "no drafts (skipped by request)" still ran
    // (diagnose() does real work) and keeps its real elapsed time.
    if (detail === "skipped by request") {
      this.write(`  ${n} ${label}${detail}`);
      return;
    }
    this.write(
      formatStageLine({
        number: n,
        label: STAGE_LABEL[p.stage],
        engines,
        detail,
        elapsedMs: this.now() - p.startedAt,
        costCents: this.costCents,
      }),
    );
  }

  private engineSummary(): string {
    // NOTE (FIDELITY): this is a count of questions PROCESSED (observe.ts's
    // done++ fires per question regardless of whether the draw succeeded),
    // not a count of SUCCESSFUL answers — a provider that 429/503'd every
    // draw still reaches N/N here. It must never carry a ✓/success implication;
    // the honest per-engine success/failure line is reportEngineFailures
    // below, printed post-hoc from the finished RunResult's real ok/error data.
    if (this.engineCounts.size === 0) return "";
    return [...this.engineCounts.entries()].map(([engine, { done, total }]) => `${engine} ${done}/${total}`).join("   ");
  }

  private engineAnswerCounts(result: RunResult): Map<Engine, { ok: number; total: number; error?: string }> {
    const byEngine = new Map<Engine, { ok: number; total: number; error?: string }>();
    for (const a of result.answers) {
      const row = byEngine.get(a.engine) ?? { ok: 0, total: 0 };
      row.total += 1;
      if (a.ok) row.ok += 1;
      else if (a.error && !row.error) row.error = a.error;
      byEngine.set(a.engine, row);
    }
    return byEngine;
  }

  /** Post-hoc, from the finished RunResult: one line per engine with ANY failed
   *  draw — total failure (0 ok) as well as a partial one (some 429/503'd, most
   *  succeeded): "gemini 0/8 · 429 rate-limited · continuing with 3 engines";
   *  a partial failure reads "perplexity 1/6 · 429 rate-limited · continuing".
   *  Returns
   *  only the engines that answered ZERO questions (today's "removed from the
   *  run" contract other callers rely on). */
  reportEngineFailures(result: RunResult): Engine[] {
    const byEngine = this.engineAnswerCounts(result);
    const failed: Engine[] = [];
    for (const engine of result.engines) {
      const row = byEngine.get(engine);
      if (!row || row.total === 0 || row.ok === row.total) continue;
      // F2 — the raw AnswerRow.error ("<kind>: <message>") mapped to ONE
      // plain sentence + ONE action for this provider, printed once per
      // failed engine (this loop runs once per engine already).
      const modelName = result.models?.[`${engine}Answer`];
      const reason = row.error ? mapProviderError(engine, row.error, modelName) : "no successful answers";
      if (row.ok === 0) {
        failed.push(engine);
        const remaining = result.engines.length - failed.length;
        this.write(
          `  ${engine} 0/${row.total} ${glyph("sep")} ${reason} ${glyph("sep")} continuing with ${remaining} engine${remaining === 1 ? "" : "s"}`,
        );
      } else {
        this.write(`  ${engine} ${row.ok}/${row.total} ${glyph("sep")} ${reason} ${glyph("sep")} continuing`);
      }
    }
    return failed;
  }

  /** `reportPath`/`verifyPath` are null when --format did not ask for that
   *  file: a line is printed only for a file that actually exists. */
  finish(
    result: RunResult,
    opts: { reportPath: string | null; verifyPath: string | null; brandDomain: string },
  ): void {
    this.flushPending();
    this.reportEngineFailures(result);
    const anyFailedDraws = result.answers.some((a) => !a.ok);
    const scores = result.scores;
    const overall = scores?.overall;
    // the denominator is the REAL count of judged answers (overall.answered:
    // scored draws that actually got an ok verdict), not the static question
    // count — a provider outage shrinks how much was actually judged, and the
    // Verdict line must say so honestly rather than implying full coverage.
    const total = overall ? overall.answered : result.questions.length;
    this.write("");
    if (overall) {
      this.write(
        `  Verdict   Mentioned in ${overall.mentioned} of ${total} answers. ` +
          `Recommended in ${overall.recommended} of ${total}.`,
      );
      this.write(`  Band      ${formatBand(scores, overall.rec_rate === null ? null : overall.recommended, total)}`);
    } else {
      this.write("  Verdict   not scored (run did not complete)");
    }
    this.write("");
    if (opts.reportPath) this.write(`  Report    ${opts.reportPath}`);
    if (opts.verifyPath) {
      this.write(`  Verify    npx saylent verify ${opts.verifyPath}   (after you ship fixes)`);
    }
    this.write(`  Total     ${fmtElapsed(this.now() - this.startedAt)} ${glyph("sep")} ${fmtUsd(Math.round(result.costUsd * 100))}`);
    if (anyFailedDraws) this.write("");
  }

  fail(message: string): void {
    this.flushPending();
    this.write("");
    this.write(`  Error     ${message}`);
  }
}

/** The Band line is a RANGE, not a point: each scored question is asked more than
 *  once, and `scores.recommended_band` is the {min,max} recommended-count across
 *  those sample-sets. Printing one number would claim a precision the run does not
 *  have — so the range is printed whenever min and max differ, and a single number
 *  only when the sample-sets agreed exactly. It is still labelled "band" either
 *  way, so a tight run reads as a band that happened to be tight rather than as a
 *  different kind of measurement.
 *
 *  `pointFallback` is the plain recommended count, used when a run carries no
 *  band at all (a smoke/single-sample run, or a run.json from an older version).
 *  null ⇒ nothing was scored. Pure + exported so the wording is unit-testable. */
export function formatBand(
  scores: { recommended_band?: { overall?: { min: number; max: number } } } | null | undefined,
  pointFallback: number | null,
  total: number,
): string {
  const band = scores?.recommended_band?.overall;
  if (band) {
    const count = band.min === band.max ? `${band.min}` : `${band.min}${glyph("ndash")}${band.max}`;
    return `recommended ${count} of ${total}`;
  }
  if (pointFallback === null) return "recommended not scored";
  return `recommended ${pointFallback} of ${total}`;
}
