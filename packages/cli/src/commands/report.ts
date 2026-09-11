// `saylent report <run.json>` — re-render report.html / report.md from an
// existing bundle (no network, no LLM, $0). Useful after editing a bundle by
// hand, or re-rendering with a newer @saylent/report version.
import path from "node:path";
import { parseArgs } from "node:util";
import { ALL_FORMATS, loadBundleFileAsync, renderReportFiles, type ReportFormat } from "../run";
import { glyph } from "../glyphs";
import { HELP_OPTION, opt, options } from "../help";

const HELP = `saylent report <run.json> [options]

Options:
${options([
  opt("--format <a,b>", "md,html (default: both)"),
  opt("--out <dir>", "Output directory (default: alongside run.json)"),
  HELP_OPTION,
])}`;

/** The formats this command can produce. `json` is the INPUT here (the bundle
 *  already exists on disk), so only the two renders are offered. */
const REPORT_FORMATS: readonly ReportFormat[] = ["md", "html"];

/** A filesystem refusal, said in one line a person can act on — and WITHOUT
 *  the absolute path, which leaks the machine's directory layout into a
 *  terminal people paste into issues. The paths the user TYPED are echoed
 *  back instead, because those are the things they can correct. */
function friendlyFsError(e: unknown, bundlePath: string, outDir: string | undefined): string | null {
  const code = (e as { code?: string } | null)?.code;
  const failedWrite = outDir !== undefined && String((e as { path?: string }).path ?? "").includes("report.");
  const where = failedWrite ? outDir : bundlePath;
  if (code === "ENOENT") {
    return failedWrite
      ? `Cannot write into ${where}: no such directory. Create it, or drop --out to write next to the bundle.`
      : `No such file: ${where}. Pass the run.json a previous audit wrote.`;
  }
  if (code === "EACCES" || code === "EPERM") {
    return `Permission denied for ${where}. Check its permissions, or pass a path you can ${failedWrite ? "write to" : "read"}.`;
  }
  if (code === "EISDIR") return `${where} is a directory. Pass the run.json inside it.`;
  return null;
}

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      format: { type: "string" },
      out: { type: "string" },
    },
  });

  const bundlePath = positionals[0];
  if (!bundlePath) {
    process.stderr.write(`Missing <run.json>.\n\n${HELP}\n`);
    return 1;
  }

  // --format decides which files are WRITTEN, not just which paths are
  // printed: asking for md alone must not leave a stale report.html behind.
  let formats: ReportFormat[] = [...REPORT_FORMATS];
  if (values.format !== undefined) {
    const names = values.format
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
    const bad = names.filter((f) => !(REPORT_FORMATS as readonly string[]).includes(f));
    if (bad.length > 0 || names.length === 0) {
      const hint = bad.some((f) => (ALL_FORMATS as readonly string[]).includes(f))
        ? " (run.json is this command's input, not an output)"
        : "";
      process.stderr.write(
        `\n  --format ${values.format}: expected a comma-separated list of ${REPORT_FORMATS.join(", ")}${hint}.\n`,
      );
      return 1;
    }
    formats = names as ReportFormat[];
  }

  let reportHtmlPath: string | null;
  let reportMdPath: string | null;
  let brand: string;
  try {
    const bundle = await loadBundleFileAsync(bundlePath);
    brand = bundle.run.brand.name || bundle.run.brand.domain;
    const outDir = values.out ?? path.dirname(path.resolve(bundlePath));
    ({ reportHtmlPath, reportMdPath } = await renderReportFiles(bundle, outDir, { formats }));
  } catch (e) {
    const friendly = friendlyFsError(e, bundlePath, values.out);
    if (friendly) {
      process.stderr.write(`\n  ${friendly}\n`);
      return 1;
    }
    throw e;
  }

  // Every other command opens with `Saylent · <cmd> · <target>` and closes with
  // a next step; this one used to print two bare absolute paths and stop.
  process.stdout.write(`\nSaylent ${glyph("sep")} report ${glyph("sep")} ${brand}\n\n`);
  if (reportHtmlPath) process.stdout.write(`  HTML      ${reportHtmlPath}\n`);
  if (reportMdPath) process.stdout.write(`  Markdown  ${reportMdPath}\n`);
  process.stdout.write(
    `\n  Next      open report.html in a browser ${glyph("sep")} saylent verify ${bundlePath} after you ship fixes\n`,
  );
  return 0;
}
