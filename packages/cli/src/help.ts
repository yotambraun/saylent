// ONE formatter for every `--help` option row in the CLI.
//
// The option blocks used to be hand-padded per command, and they drifted:
// `saylent audit --help` and `saylent models --help` lined their descriptions
// up at column 26 while `saylent verify --help` used three different columns
// inside a single list. A help screen whose columns do not line up reads as
// unfinished at exactly the moment a stranger is deciding whether to trust the
// tool with an API key — so the column is a constant, the rows go through one
// function, and help-alignment.test.ts asserts it holds on all nine screens.
//
// Descriptions are NOT auto-wrapped here: every one of them is prose somebody
// wrote to break in a particular place, and a re-wrapper would silently
// reflow it. Pass the extra lines instead; they are indented to the same
// column as the first.

/** The column (0-based) every option description starts at. Chosen because it
 *  is what the widest shared row already needs:
 *  `  --model <role>=<model>  ` = 2 indent + 22 flag + 2 gap. */
export const OPTION_COLUMN = 26;

/** Left indent for an option row, matching every other block the CLI prints. */
const INDENT = "  ";

/**
 * One option row: `  --flag <arg>            First line`, plus any
 * continuation lines indented to the same column.
 *
 * A flag too WIDE for the column keeps the column anyway: it takes a line of
 * its own and the whole description drops to the next line, still at
 * OPTION_COLUMN. Squeezing it in one space away would put a single
 * description at a column no other row uses, which is precisely the drift
 * this module exists to prevent.
 */
export function opt(flag: string, ...description: string[]): string {
  const head = `${INDENT}${flag}`;
  const continuation = " ".repeat(OPTION_COLUMN);
  const lines = description.filter((l) => l !== "");
  if (head.length + 1 > OPTION_COLUMN) {
    return [head, ...lines.map((l) => `${continuation}${l}`)].join("\n");
  }
  const [first = "", ...rest] = lines;
  const pad = " ".repeat(OPTION_COLUMN - head.length);
  return [`${head}${pad}${first}`, ...rest.map((l) => `${continuation}${l}`)].join("\n");
}

/** Several rows, newline-joined — the whole `Options:` body. */
export function options(rows: string[]): string {
  return rows.join("\n");
}

/** The `--help` row itself, identical everywhere. */
export const HELP_OPTION = opt("--help", "Show this message");
