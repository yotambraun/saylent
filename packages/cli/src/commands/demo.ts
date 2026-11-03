// `saylent demo` — the keyless first run. Renders the bundled Kestrel sample
// (examples/kestrel/run.json: a real, unedited smoke run against a fictional
// product we host ourselves) into report.html + report.md. No API key, no
// network, no LLM call, $0. It never reads a key file or a provider variable,
// so a first-time user sees the full report before deciding to pay for a run.
import { spawn } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { glyph } from "../glyphs";
import { HELP_OPTION, opt, options } from "../help";
import { findSampleBundle } from "../repo-root";
import { loadBundleFileAsync, renderReportFiles } from "../run";

export const DEFAULT_DEMO_DIR = "saylent-demo";

const HELP = `saylent demo [options]

Render the bundled sample report (Kestrel Uptime, a fictional product we host,
audited by a real smoke run) offline. No API key, no network, no cost.

Options:
${options([
  opt("--out <dir>", `Output directory (default: ./${DEFAULT_DEMO_DIR})`),
  opt("--open", "Open report.html in your default browser afterwards"),
  HELP_OPTION,
])}`;

/** The platform's "open this file" command. Exported for the unit test. */
export function openCommand(platform: NodeJS.Platform = process.platform): { cmd: string; args: string[] } {
  if (platform === "darwin") return { cmd: "open", args: [] };
  if (platform === "win32") return { cmd: "cmd", args: ["/c", "start", '""'] };
  return { cmd: "xdg-open", args: [] };
}

function openInBrowser(file: string): void {
  const { cmd, args } = openCommand();
  try {
    const child = spawn(cmd, [...args, file], { stdio: "ignore", detached: true });
    child.on("error", () => {
      process.stderr.write(`  Could not open a browser (${cmd}); open the file above by hand.\n`);
    });
    child.unref();
  } catch {
    process.stderr.write(`  Could not open a browser (${cmd}); open the file above by hand.\n`);
  }
}

export interface DemoDeps {
  /** where the sample bundle lives (default: shipped next to the CLI) */
  sample?: string | null;
  open?: (file: string) => void;
}

export async function run(argv: string[], deps: DemoDeps = {}): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      out: { type: "string" },
      open: { type: "boolean" },
    },
  });

  const sample = deps.sample === undefined ? findSampleBundle() : deps.sample;
  if (!sample) {
    process.stderr.write(
      "\n  The sample run is missing from this install. Reinstall saylent, or render any run.json with\n" +
        "  saylent report <run.json>.\n",
    );
    return 1;
  }

  const outDir = path.resolve(values.out ?? DEFAULT_DEMO_DIR);
  const bundle = await loadBundleFileAsync(sample);
  await mkdir(outDir, { recursive: true });
  // The bundle goes next to the report so `saylent report` / `saylent history`
  // work on the demo folder exactly as on a real audit's output.
  const runJsonPath = path.join(outDir, "run.json");
  await copyFile(sample, runJsonPath);
  const { reportHtmlPath, reportMdPath } = await renderReportFiles(bundle, outDir);

  const r = bundle.run;
  const date = (r.finished_at ?? r.started_at ?? "").slice(0, 10);
  const cost = typeof r.est_cost_usd === "number" ? `$${r.est_cost_usd.toFixed(2)}` : "not recorded";
  const sep = glyph("sep");
  process.stdout.write(`\nSaylent ${sep} demo ${sep} ${r.brand.name}\n\n`);
  process.stdout.write(
    `  Sample    a recorded ${r.profile} run from ${date}, ${r.engines.length} engines, cost ${cost} when it ran\n` +
      `            (rendered here offline: no key, no network, $0)\n\n`,
  );
  if (reportHtmlPath) process.stdout.write(`  HTML      ${reportHtmlPath}\n`);
  if (reportMdPath) process.stdout.write(`  Markdown  ${reportMdPath}\n`);
  process.stdout.write(`  Bundle    ${runJsonPath}\n`);
  // The $0 commands that read a run, pointed at the folder just written, so
  // the demo shows what the rest of the tool does with a run.
  const rel = path.relative(process.cwd(), outDir) || ".";
  process.stdout.write(
    `\n  Explore   npx saylent sources ${rel} ${sep} npx saylent fixes ${rel} ${sep} npx saylent export ${rel}   ($0)\n` +
      `  Next      npx saylent audit <your-domain> --dry-run   (prices a real run before any call)\n`,
  );

  if (values.open && reportHtmlPath) (deps.open ?? openInBrowser)(reportHtmlPath);
  return 0;
}
