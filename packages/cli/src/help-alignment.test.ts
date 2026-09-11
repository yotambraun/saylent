// Every `--help` screen renders its option rows through help.ts's one
// formatter, so every option description starts at the same column. This used
// to drift: `saylent verify --help` had three different columns inside a
// single list, which is the kind of thing a stranger reads as "unfinished" at
// exactly the moment they are deciding whether to hand the tool an API key.
import { describe, expect, it, vi } from "vitest";
import { OPTION_COLUMN, opt } from "./help";
import { run as audit } from "./commands/audit";
import { run as verify } from "./commands/verify";
import { run as gateCheck } from "./commands/gate-check";
import { run as report } from "./commands/report";
import { run as history } from "./commands/history";
import { run as keys } from "./commands/keys";
import { run as questions } from "./commands/questions";
import { run as models } from "./commands/models";
import { run as mcp } from "./commands/mcp";
import { main } from "./index";

const SCREENS: [string, (argv: string[]) => Promise<number>][] = [
  ["audit", audit],
  ["verify", verify],
  ["gate-check", gateCheck],
  ["report", report],
  ["history", history],
  ["keys", keys],
  ["questions", questions],
  ["models", models],
  ["mcp", mcp],
  ["(root)", (argv) => main(argv)],
];

async function helpText(fn: (argv: string[]) => Promise<number>): Promise<string> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
    chunks.push(String(c));
    return true;
  });
  const code = await fn(["--help"]);
  spy.mockRestore();
  expect(code).toBe(0);
  return chunks.join("");
}

/** Where the description starts on a `  --flag ...  Description` row: the
 *  first two-or-more-space gap after the two-space indent. A row that is only
 *  a flag (a wide flag whose description dropped to the next line) has no such
 *  gap and is not measured. */
function descriptionColumns(text: string): number[] {
  const out: number[] = [];
  for (const line of text.split("\n")) {
    if (!/^ {2}--/.test(line)) continue;
    const gap = / {2,}(?=\S)/.exec(line.slice(2));
    if (gap) out.push(2 + gap.index + gap[0].length);
  }
  return out;
}

describe("help.ts option formatter", () => {
  it("pads the flag to the shared column", () => {
    expect(opt("--yes", "Skip it").indexOf("Skip it")).toBe(OPTION_COLUMN);
  });

  it("indents continuation lines to the same column", () => {
    const lines = opt("--profile <profile>", "first", "second").split("\n");
    expect(lines[0].indexOf("first")).toBe(OPTION_COLUMN);
    expect(lines[1].indexOf("second")).toBe(OPTION_COLUMN);
  });

  it("a flag wider than the column drops its description to the next line, at the same column", () => {
    const long = opt("--user-agent, --max-pages, --allow-private, --locale", "note");
    const lines = long.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].trimEnd()).toBe("  --user-agent, --max-pages, --allow-private, --locale");
    expect(lines[1].indexOf("note")).toBe(OPTION_COLUMN);
  });
});

describe("every help screen", () => {
  it.each(SCREENS)("%s starts every option description at column %i", async (_name, fn) => {
    const cols = descriptionColumns(await helpText(fn));
    for (const c of cols) expect(c).toBe(OPTION_COLUMN);
  });

  it("all nine command screens use the SAME column as each other", async () => {
    const all: number[] = [];
    for (const [, fn] of SCREENS) all.push(...descriptionColumns(await helpText(fn)));
    expect(all.length).toBeGreaterThan(20);
    expect(new Set(all)).toEqual(new Set([OPTION_COLUMN]));
  });
});
