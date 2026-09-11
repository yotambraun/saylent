// `saylent history <dir>` — lists past runs for a directory.
import { parseArgs } from "node:util";
import { formatHistoryTable, scanHistoryDir } from "../history";
import { HELP_OPTION } from "../help";

const HELP = `saylent history <dir>

Lists past runs in a brand's output directory (./<domain>/<YYYY-MM-DD>/), or a
single run.json sitting directly in <dir>.

Options:
${HELP_OPTION}`;

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const { positionals } = parseArgs({ args: argv, allowPositionals: true, options: {} });
  const dir = positionals[0];
  if (!dir) {
    process.stderr.write(`Missing <dir>.\n\n${HELP}\n`);
    return 1;
  }
  const rows = scanHistoryDir(dir);
  if (rows.length === 0) {
    // The old message was `No runs found in ${dir}.` — with `dir` = "." that
    // printed a literal double period, and it never said what layout it
    // expected, so nobody could tell a wrong folder from an empty one.
    process.stdout.write(
      `No runs found under ${dir} (expected ${dir}/<YYYY-MM-DD>/run.json or a run.json directly inside it).\n`,
    );
    return 0;
  }
  for (const line of formatHistoryTable(rows)) process.stdout.write(`${line}\n`);
  return 0;
}
