// The MCP `questions_import` tool: a $0 PREVIEW of `saylent questions import`.
// It parses and filters a Search Console export, a CSV or text lines with the
// same engine function, and returns what would be kept and dropped. It never
// writes a file: the user runs the CLI (or edits in the app) to keep the set.
import { readFileSync, statSync } from "node:fs";
import { previewQuestionImport, type ImportFormat } from "@saylent/engine/question-import";
import { resolveInside } from "./crawlers";

export interface QuestionsImportArgs {
  file_path: string;
  format?: "gsc" | "csv" | "text";
  column?: string;
  min_impressions?: number;
  exclude?: string[];
  include?: string[];
  questions_only?: boolean;
  cluster?: boolean;
  max?: number;
  language?: string;
  country?: string;
}

/** 5 MB: a Search Console Queries export is at most 1,000 rows. */
export const PREVIEW_MAX_BYTES = 5_000_000;

export function questionsImportTool(args: QuestionsImportArgs, cwd = process.cwd()): Record<string, unknown> {
  const file = resolveInside(args.file_path, cwd, "file_path");
  if (statSync(file).size > PREVIEW_MAX_BYTES) throw new Error(`${args.file_path} is larger than 5 MB; filter it first.`);
  const p = previewQuestionImport({
    text: readFileSync(file, "utf8"),
    filename: file,
    options: {
      format: (args.format as ImportFormat | undefined) ?? "auto",
      column: args.column ?? null,
      minImpressions: args.min_impressions ?? null,
      exclude: args.exclude,
      include: args.include,
      questionsOnly: args.questions_only,
      cluster: args.cluster,
      max: args.max,
      language: args.language ?? null,
      country: args.country ?? null,
    },
  });
  return {
    file_path: file,
    ...p,
    next: `To keep this set, run: saylent questions import ${args.file_path} (same options), then saylent audit <domain> --questions questions.json`,
    cost_usd: 0,
  };
}
