#!/usr/bin/env node
// scripts/media/cli-recording.mjs — builds the CLI recording: the terminal
// recording embedded in the README. It replays a real Kestrel run as a
// terminal transcript and renders it to an animated GIF.
//
// No LLM call, no network, no browser: every line is composed from
// examples/kestrel/run.json (the real bundle) using the exact output format of
// packages/cli/src/preflight.ts and packages/cli/src/progress.ts, then drawn
// as SVG frames and encoded with sharp, which is already a dependency. That
// also means the GIF can be regenerated on any machine, including one with no
// Chromium.
//
// HONESTY NOTES — read these before changing a number here:
//   * Every count comes from run.json: 23 questions frozen, 6 asked on smoke
//     (24 answers / 4 engines), 24 draws, 112 citations, 11 corpus pages, 23
//     domain checks, 4 fixes, and the 0-of-9 verdict. The closing Total is the
//     run's own start/end timestamps and its own est_cost_usd.
//   * run.json does NOT carry per-stage durations, so the stage lines show
//     real counts and NO elapsed column, and the live engines line shows no
//     running-cost column either (the real CLI prints one only once measured
//     provider usage has arrived; inventing one here would be a lie).
//   * The cost ESTIMATE on the Profile line is not in run.json. It is what
//     preflight.ts's estimateCostRange() returns for smoke with all four
//     engines: answers 1.3c-4c x 24 draws, plus brand 2c, judge 0.4c/call and
//     drafter 2.5c x 2 (run-audit.ts ROLE_COST_CENTS) => $0.38-$1.13. The
//     recorded run cost $0.93, inside that range.
//   * The two engine-failure lines use the CLI's own wording for the kinds
//     this bundle's errors state (Gemini HTTP 503 = server, Perplexity HTTP
//     429 = rate_limit; errors.ts MESSAGES). The bundle predates the adapters
//     stamping "<kind>: <message>", so replaying its raw strings through
//     mapProviderError() today would print the generic raw-JSON fallback
//     rather than the sentence a run prints now.
//
//   node scripts/media/cli-recording.mjs [--dry-run]

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureDir, KESTREL_RUN, MEDIA_DIR, parseFlags, printPlan, TOKENS } from "./lib.mjs";

const WIDTH = 1280;
const FONT_SIZE = 15;
const CHAR_W = FONT_SIZE * 0.6;
const LINE_H = 21;
const PAD_X = 30;
const PAD_TOP = 34;
const PAD_BOTTOM = 22;
const MONO = "'DejaVu Sans Mono','Liberation Mono',Menlo,Consolas,monospace";
const OUT = join(MEDIA_DIR, "cli.gif");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function fmtElapsed(ms) {
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

/** preflight.ts estimateCostRange("smoke", all four engines) — see the
 *  HONESTY NOTES at the top of this file for the arithmetic. */
const SMOKE_ESTIMATE = "$0.38–$1.13";

/** errors.ts MESSAGES[engine][kind] for the kinds this bundle's own HTTP
 *  codes state. */
const FAILURE_SENTENCE = {
  gemini: "Gemini is having trouble. The other engines continue.",
  perplexity:
    "Perplexity rate-limited this run — common on a brand-new key. Retrying with backoff; lower `--samples` or wait a minute.",
};

/** The transcript, built from the real bundle. Returns [{ text, tone }]. */
export function transcript(bundle) {
  const { run, questions, answers, citations, corpus_pages: pages, domain_checks: checks, fixes, scores } = bundle;
  const domain = run.brand.domain;
  const overall = scores.overall;

  const perEngine = new Map();
  for (const a of answers) {
    const row = perEngine.get(a.engine) ?? { ok: 0, total: 0 };
    row.total += 1;
    if (a.ok) row.ok += 1;
    perEngine.set(a.engine, row);
  }
  // progress.ts's live "04 engines" line counts draws PROCESSED, not draws
  // that succeeded (the FIDELITY note in progress.ts): every engine reaches
  // N/N here, and the honest per-engine success/failure line is the separate
  // reportEngineFailures block below. The old transcript printed ok/total on
  // this line, which is a number the CLI never shows.
  const asked = answers.length / run.engines.length;
  const engineLive = run.engines.map((e) => `${e} ${perEngine.get(e)?.total ?? 0}/${asked}`).join(" · ");
  // the CLI writes <domain>/<YYYY-MM-DD>/ under the current folder (run.ts)
  const outDir = `${domain}/${run.started_at.slice(0, 10)}`;
  const elapsed = fmtElapsed(Date.parse(run.finished_at) - Date.parse(run.started_at));
  // progress.ts flushPending(): "  NN label(padEnd 12)detail". No elapsed
  // column, because run.json carries no per-stage durations.
  const stage = (n, label, detail) => ({
    text: `  ${String(n).padStart(2, "0")} ${label.padEnd(12)}${detail}`,
    tone: "fg",
  });
  const failures = run.engines
    .filter((e) => (perEngine.get(e)?.ok ?? 0) < (perEngine.get(e)?.total ?? 0))
    .map((e) => ({
      text: `  ${e} ${perEngine.get(e).ok}/${perEngine.get(e).total} · ${FAILURE_SENTENCE[e]} · continuing`,
      tone: "dim",
    }));

  return [
    { text: `$ npx saylent audit ${domain}`, tone: "prompt", type: true },
    { text: "", tone: "fg" },
    { text: `Saylent · audit · ${domain}`, tone: "fg" },
    { text: "", tone: "fg" },
    { text: `  Keys      OpenAI ✓   Anthropic ✓   Gemini ✓   Perplexity ✓`, tone: "dim" },
    { text: `  Engines   ${run.engines.join(", ")}`, tone: "dim" },
    {
      text: `  Judge     ${run.judge_mode} (OpenAI ↔ Anthropic)  ·  ${run.models.judge_anthropic} / ${run.models.judge_openai}`,
      tone: "dim",
    },
    {
      text: `  Profile   ${run.profile} · ${asked} questions · ${run.engines.length} engines · est. ${SMOKE_ESTIMATE} of your credits`,
      tone: "signal",
    },
    { text: `  Output    ${outDir}/  (run.json · report.html · report.md)`, tone: "dim" },
    { text: `  Sampling  1x scored questions (${run.profile} default)`, tone: "dim" },
    { text: "", tone: "fg" },
    { text: "  Run it? [Y/n] y", tone: "prompt" },
    { text: "", tone: "fg" },
    stage(1, "crawl", domain),
    stage(2, "brand model", run.brand.name),
    stage(3, "questions", `template v${run.template_set_version} · ${questions.length} frozen · ${run.profile} asks ${asked}`),
    stage(4, "engines", engineLive),
    stage(5, "judge", `${answers.length} draws`),
    stage(6, "cited pages", `${answers.length} answers · ${citations.length} citations · ${pages.length} pages fetched`),
    stage(7, "site gates", `${domain} · ${checks.length} checks`),
    stage(8, "fix plan", `${fixes.length} fixes drafted`),
    stage(9, "score", "share of voice · confidence band"),
    // progress.ts reportEngineFailures: the per-engine failure lines print once
    // the run has finished, after the last stage (verified on a recorded run).
    ...failures,
    { text: "", tone: "fg" },
    {
      text: `  Verdict   Mentioned in ${overall.mentioned} of ${overall.answered} answers. Recommended in ${overall.recommended} of ${overall.answered}.`,
      tone: "signal",
    },
    { text: `  Band      recommended ${overall.recommended} of ${overall.answered}`, tone: "fg" },
    { text: "", tone: "fg" },
    { text: `  Report    ${outDir}/report.html`, tone: "fg" },
    { text: `  Verify    npx saylent verify ${outDir}/run.json   (after you ship fixes)`, tone: "dim" },
    { text: `  Total     ${elapsed} · $${run.est_cost_usd.toFixed(2)}`, tone: "fg" },
    { text: "", tone: "fg" },
    { text: "  ★ Useful? Star the repo: github.com/yotambraun/saylent   (shown once)", tone: "signal" },
    { text: "  Kestrel Uptime is a fictional company we audit.", tone: "dim" },
  ];
}

/** Terminal soft-wrap: the CLI writes one long line, a terminal folds it. The
 *  provider-failure sentences are the only lines that reach this, and they are
 *  the real ones — shortening them here would be editing the product's words
 *  to fit a picture. Continuations are indented under the first, the way a
 *  reader expects. */
const MAX_COLS = 118;

function wrapLines(lines) {
  const out = [];
  for (const line of lines) {
    if (line.text.length <= MAX_COLS) {
      out.push(line);
      continue;
    }
    const lead = (/^ */.exec(line.text) ?? [""])[0];
    const hang = `${lead}    `;
    let current = lead;
    for (const word of line.text.trimStart().split(/ +/)) {
      const candidate = current.trimEnd() === "" ? current + word : `${current} ${word}`;
      if (candidate.length > MAX_COLS && current.trim() !== "") {
        out.push({ ...line, text: current });
        current = hang + word;
      } else {
        current = candidate;
      }
    }
    if (current.trim() !== "") out.push({ ...line, text: current });
  }
  return out;
}

/** The canvas is cropped to the transcript: PAD_TOP for the first baseline,
 *  one LINE_H per line, PAD_BOTTOM under the last. A fixed 720px frame left a
 *  dead band under a 34-line transcript. */
function canvasHeight(lineCount) {
  return PAD_TOP + lineCount * LINE_H + PAD_BOTTOM;
}

function frameSvg(lines, height, { caret = false } = {}) {
  const t = TOKENS.dark;
  const colour = { fg: t.ink, dim: t.wire, signal: t.signal, prompt: t.ink };
  const body = lines
    .map((l, i) => {
      if (!l.text) return "";
      const y = PAD_TOP + i * LINE_H;
      const len = (l.text.length * CHAR_W).toFixed(1);
      return `<text x="${PAD_X}" y="${y}" font-family="${MONO}" font-size="${FONT_SIZE}" fill="${colour[l.tone] ?? t.ink}" textLength="${len}" lengthAdjust="spacingAndGlyphs" xml:space="preserve">${esc(l.text)}</text>`;
    })
    .join("\n  ");
  const caretLine = lines[lines.length - 1];
  const caretX = PAD_X + (caretLine?.text.length ?? 0) * CHAR_W + CHAR_W * 0.5;
  const caretY = PAD_TOP + (lines.length - 1) * LINE_H;
  const caretRect = caret
    ? `<rect x="${caretX.toFixed(1)}" y="${caretY - FONT_SIZE + 3}" width="${CHAR_W.toFixed(1)}" height="${FONT_SIZE}" fill="${t.signal}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}">
  <rect width="${WIDTH}" height="${height}" fill="${t.paper}"/>
  <rect x="0" y="0" width="${WIDTH}" height="6" fill="${t.signal}"/>
  ${body}
  ${caretRect}
</svg>`;
}

/** One frame per revealed line, plus a hold on the verdict and at the end.
 *  A blank line gets NO frame of its own: it is revealed together with the
 *  line under it, so the recording does not open on a dead beat. */
function storyboard(lines) {
  const frames = [];
  for (let i = 1; i <= lines.length; i += 1) {
    const last = lines[i - 1];
    if (last.text === "" && i !== lines.length) continue;
    const isPause = last.tone === "signal" || last.tone === "prompt" || /^  0[19] /.test(last.text);
    frames.push({ lines: lines.slice(0, i), delay: isPause ? 900 : 260, caret: i === 1 });
  }
  frames.push({ lines, delay: 2600, caret: false });
  return frames;
}

export async function buildCliRecording({ dryRun = false } = {}) {
  const bundle = JSON.parse(await readFile(KESTREL_RUN, "utf8"));
  const lines = wrapLines(transcript(bundle));
  const height = canvasHeight(lines.length);
  const frames = storyboard(lines);
  if (dryRun) {
    printPlan("cli-recording.mjs", {
      steps: [
        "compose the transcript from examples/kestrel/run.json (no LLM, no network)",
        `render ${frames.length} SVG frames at ${WIDTH}x${height}`,
        `encode an animated GIF (~${(frames.reduce((a, f) => a + f.delay, 0) / 1000).toFixed(0)}s)`,
      ],
      inputs: ["examples/kestrel/run.json"],
      outputs: [OUT],
    });
    return [OUT];
  }

  const { default: sharp } = await import("sharp");
  await ensureDir(MEDIA_DIR);
  const raw = [];
  for (const frame of frames) {
    // flatten() drops the SVG alpha channel so every frame is exactly 3 bytes
    // per pixel, which is what the raw pageHeight input below declares.
    raw.push(
      await sharp(Buffer.from(frameSvg(frame.lines, height, { caret: frame.caret })))
        .flatten({ background: TOKENS.dark.paper })
        .raw()
        .toBuffer(),
    );
  }
  await sharp(Buffer.concat(raw), {
    raw: { width: WIDTH, height: height * frames.length, channels: 3, pageHeight: height },
  })
    .gif({ delay: frames.map((f) => f.delay), loop: 0, colours: 32 })
    .toFile(OUT);
  console.log(`  wrote ${OUT} (${frames.length} frames, ${WIDTH}x${height})`);
  return [OUT];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildCliRecording(parseFlags());
}
