// `saylent questions import <file>` — real questions in: a Google Search
// Console Performance export (Queries.csv), any CSV, or plain text lines, into
// a questions.json that `saylent audit --questions` asks verbatim. $0 and
// offline: filtering, dedupe and clustering are plain, stated rules
// (@saylent/engine/question-import), and every dropped row is counted.
//
// --rewrite (optional) asks your drafter model to turn search queries into
// natural questions: it prints the estimate first and spends only with --yes
// or a typed "y". The original query stays on each question as `from`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  IMPORT_MAX_CAP,
  IMPORT_MAX_DEFAULT,
  importQuestions,
  importSummary,
  parseRewrite,
  questionRewritePrompt,
  toQuestionsJson,
  type ImportFormat,
  type ImportResult,
} from "@saylent/engine/question-import";
import { DEFAULT_ROLE_MODEL, callCents, rateFor } from "@saylent/engine/rates";
import { glyph } from "../glyphs";
import { HELP_OPTION, opt, options } from "../help";
import { applyKeysToEnv, hasMinimumKeys, resolveKeys } from "../keys";
import { confirmRun, NotATerminalError, recordSpend } from "../preflight";
import { QUESTION_TYPES, SCORED_TYPES } from "../questions-file";

export const IMPORT_HELP = `saylent questions import <file> [options]

Turn what people actually search into questions an audit asks. Reads a Google
Search Console Performance export (the Queries.csv in its ZIP), any CSV with
--column, or a text file with one question per line. $0, offline: rows are
normalized, filtered, deduplicated and (with --cluster) merged by stated
rules, ranked by impressions then clicks, and every dropped row is counted.

Options:
${options([
  opt("--out <file>", "Where to write (default: ./questions.json; --force to overwrite)"),
  opt("--format <f>", "gsc, csv or text (default: detected)"),
  opt("--column <name|n>", "CSV: the column holding the queries or questions"),
  opt("--weight-column <c>", "CSV: a numeric column to rank by"),
  opt("--min-impressions <n>", "GSC: drop queries seen fewer times"),
  opt("--exclude <regex>", "Drop matching rows, e.g. your brand name (repeatable)"),
  opt("--include <regex>", "Keep only matching rows (repeatable)"),
  opt("--questions-only", "Keep question-shaped rows: ending in ? or starting with an English question word"),
  opt("--cluster", "Merge near-identical queries (same words in any order, minus common English words)"),
  opt("--max <n>", `How many to keep (default ${IMPORT_MAX_DEFAULT}, max ${IMPORT_MAX_CAP})`),
  opt("--type <type>", `Question type for every row (default custom; ${QUESTION_TYPES.join(", ")})`),
  opt("--language <tag>", "The set's language (BCP 47, e.g. de): answer surfaces are asked in it"),
  opt("--country <cc>", "The set's country (e.g. de): answer surfaces answer from there"),
  opt("--rewrite", "Rewrite queries as natural questions with your drafter model (costs; asks first)"),
  opt("--yes", "Skip the rewrite confirmation"),
  opt("--preview", "Print what would be kept and dropped; write nothing"),
  opt("--json", "Print the questions.json instead of writing it"),
  opt("--force", "Overwrite --out"),
  HELP_OPTION,
])}

Then: saylent audit <domain> --questions questions.json
Only ${SCORED_TYPES.join(" and ")} questions count toward the score and the recommended
band; tag rows with --type ${SCORED_TYPES[0]} only when they really are category
questions. Model engines are asked the text verbatim, so they answer in its
language; --language/--country set the answer surfaces' locale (Google AI
Overviews, AI Mode).`;

export interface ImportIo {
  /** the rewrite call (tests inject a fake; never a real model in tests) */
  complete?: (prompt: string) => Promise<string | null>;
  confirmIo?: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream; isTTY?: boolean };
}

/** The rewrite estimate in cents: prompt + one ~20-token line per query, on
 *  the drafter's default model (an upper estimate). */
export function rewriteEstimateCents(queries: string[], language?: string | null): number {
  const prompt = questionRewritePrompt(queries, language);
  const rate = rateFor(DEFAULT_ROLE_MODEL.drafter);
  if (!rate) return 1;
  return callCents(rate, { input_tokens: Math.ceil(prompt.length / 4) + 50, output_tokens: queries.length * 20 + 50 });
}

export function formatImport(r: ImportResult): string {
  const out: string[] = [];
  out.push(`\nSaylent ${glyph("sep")} questions import ${glyph("sep")} ${r.format}${r.column ? ` (column "${r.column}")` : ""}\n`);
  out.push(`  ${importSummary(r)}`);
  for (const w of r.warnings) out.push(`  ${w}`);
  if (r.locale) out.push(`  Locale    ${[r.locale.language && `language ${r.locale.language}`, r.locale.country && `country ${r.locale.country}`].filter(Boolean).join(` ${glyph("sep")} `)}`);
  out.push("");
  r.kept.forEach((q, i) => {
    const metrics = q.impressions !== undefined ? `  ${q.impressions.toLocaleString("en-US")} impr.${q.clicks !== undefined ? ` ${glyph("sep")} ${q.clicks.toLocaleString("en-US")} ${q.clicks === 1 ? "click" : "clicks"}` : ""}` : "";
    out.push(`  ${String(i + 1).padStart(2)}. ${q.text}${metrics}${q.variants?.length ? `  (+${q.variants.length} variant${q.variants.length === 1 ? "" : "s"})` : ""}`);
  });
  return `${out.join("\n")}\n`;
}

const collect = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export async function runQuestionsImport(argv: string[], io: ImportIo = {}): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${IMPORT_HELP}\n`);
    return 0;
  }
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      format: { type: "string" },
      column: { type: "string" },
      "weight-column": { type: "string" },
      "min-impressions": { type: "string" },
      exclude: { type: "string", multiple: true },
      include: { type: "string", multiple: true },
      "questions-only": { type: "boolean", default: false },
      cluster: { type: "boolean", default: false },
      max: { type: "string" },
      type: { type: "string" },
      language: { type: "string" },
      country: { type: "string" },
      rewrite: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      preview: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
    },
  });
  const file = positionals[0];
  const fail = (msg: string) => {
    process.stderr.write(`\n  ${msg}\n`);
    return 1;
  };
  if (!file) {
    process.stderr.write(`Missing <file>.\n\n${IMPORT_HELP}\n`);
    return 1;
  }
  if (!existsSync(file)) return fail(`${file}: no such file.`);
  if (values.format && !["gsc", "csv", "text"].includes(values.format)) return fail(`--format ${values.format}: expected gsc, csv or text.`);
  if (values.type && !(QUESTION_TYPES as readonly string[]).includes(values.type)) return fail(`--type ${values.type}: expected one of ${QUESTION_TYPES.join(", ")}.`);
  const max = values.max === undefined ? IMPORT_MAX_DEFAULT : Number(values.max);
  if (!Number.isInteger(max) || max < 1 || max > IMPORT_MAX_CAP) return fail(`--max ${values.max}: expected a whole number 1-${IMPORT_MAX_CAP}.`);
  const minImp = values["min-impressions"] === undefined ? null : Number(values["min-impressions"]);
  if (minImp !== null && (!Number.isFinite(minImp) || minImp < 0)) return fail(`--min-impressions ${values["min-impressions"]}: expected a number.`);
  if (/\.zip$/i.test(file)) return fail("That is the export ZIP. Unzip it and import the Queries.csv inside.");

  let result: ImportResult;
  try {
    result = importQuestions(
      readFileSync(file, "utf8"),
      {
        format: (values.format as ImportFormat | undefined) ?? "auto",
        column: values.column ?? null,
        weightColumn: values["weight-column"] ?? null,
        minImpressions: minImp,
        include: collect(values.include),
        exclude: collect(values.exclude),
        questionsOnly: values["questions-only"],
        cluster: values.cluster,
        max,
        language: values.language ?? null,
        country: values.country ?? null,
      },
      path.basename(file),
    );
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  if (result.kept.length === 0) {
    process.stdout.write(formatImport(result));
    return fail("Nothing to write: every row was dropped (see the counts above).");
  }

  let rewritten: Map<string, string> | undefined;
  if (values.rewrite && !values.preview) {
    const queries = result.kept.map((q) => q.text);
    const cents = rewriteEstimateCents(queries, result.locale?.language);
    process.stdout.write(`\n  Rewrite   ${queries.length} queries in one drafter call ${glyph("sep")} est. under $${Math.max(0.01, cents / 100).toFixed(2)} of your credits\n`);
    let complete = io.complete;
    if (!complete) {
      const { keys } = resolveKeys();
      if (!hasMinimumKeys(keys)) return fail("--rewrite needs an OpenAI or Anthropic key (saylent keys set openai). Nothing was sent.");
      applyKeysToEnv(keys);
      const { drafterCall } = await import("@saylent/engine/llm");
      complete = (prompt) => drafterCall({ system: "You rewrite search queries as natural questions.", user: prompt, maxTokens: Math.min(4000, 200 + queries.length * 60) });
    }
    if (!values.yes) {
      try {
        if (!(await confirmRun(io.confirmIo))) {
          process.stdout.write("  Rewrite skipped; writing the queries as they are.\n");
          complete = undefined;
        }
      } catch (e) {
        if (e instanceof NotATerminalError) return fail("--rewrite spends credits: pass --yes to confirm when not in a terminal.");
        throw e;
      }
    }
    if (complete) {
      const outText = await complete(questionRewritePrompt(queries, result.locale?.language));
      rewritten = outText ? parseRewrite(queries, outText) : new Map();
      if (!io.complete) recordSpend(cents / 100);
      process.stdout.write(
        rewritten.size === queries.length
          ? `  Rewrite   ${rewritten.size} questions rewritten; each keeps its query as "from".\n`
          : "  Rewrite   the model's answer did not line up with the queries; kept the queries as they are.\n",
      );
      if (rewritten.size !== queries.length) rewritten = undefined;
    }
  }

  const doc = toQuestionsJson(result, { file: path.basename(file), type: values.type ?? "custom", rewritten });
  if (values.json) {
    process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(formatImport(result));
  if (values.preview) {
    process.stdout.write("\n  Preview only: nothing written.\n");
    return 0;
  }
  const out = path.resolve(values.out ?? "questions.json");
  if (existsSync(out) && !values.force) return fail(`${out} exists. Pass --force to overwrite, or --out <file>.`);
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  process.stdout.write(`\n  Wrote     ${out}\n  Next      saylent audit <domain> --questions ${path.relative(process.cwd(), out) || out}\n`);
  return 0;
}
