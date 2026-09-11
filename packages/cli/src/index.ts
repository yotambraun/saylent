#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
// saylent — the open-source CLI door. Command dispatch only; each command owns
// its own argument parsing and help text.
//
// STARTUP WEIGHT: every command module is loaded with a dynamic import()
// INSIDE its switch branch, never statically at the top of this file. Loading
// them eagerly meant `saylent --help` evaluated commands/mcp.ts (the MCP SDK),
// commands/audit.ts -> run.ts -> progress.ts (cheerio, via
// @saylent/engine/crawl) and the report renderers before it could print a line
// of text — and it meant `--help` would die if any one of those failed to
// load. Every specifier below is a LITERAL string, which is also what lets
// esbuild resolve them at build time (see scripts/build.mjs and
// engine-loader.ts's note on why literal specifiers are mandatory here).
import { cliVersion, cliDescription } from "./version";
import { redactKnownSecrets } from "./redact";
import { maybeStarAsk } from "./star-ask";

const DOCS_URL = "https://yotambraun.github.io/saylent/";

/** Every command name, in the order --help lists them. Also the vocabulary the
 *  "did you mean" suggestion is measured against. */
const COMMANDS = [
  "audit",
  "verify",
  "gate-check",
  "report",
  "history",
  "keys",
  "questions",
  "models",
  "mcp",
] as const;

/** `check` is a documented alias for gate-check; it is suggestible but is not
 *  listed as a tenth command. */
const ALIASES = ["check"];

function help(): string {
  // The description is package.json's own, so npm's package page and this
  // screen can never say two different things about what the tool is. The
  // example is next, because the fastest way to understand a CLI is one line
  // you can paste.
  return `${cliDescription()}

  npx saylent audit example.com

saylent <command> [options]

Commands:
  audit <domain>       Run a full AI-answer audit and write a report
  verify <run.json>    Re-run the frozen questions and show movement
  gate-check <domain>  Check what AI bots can read on a site (alias: check)
  report <run.json>    Re-render report.html / report.md from a run
  history <dir>        List past runs in a brand's output directory
  keys                 Manage provider API keys
  questions <domain>   Print + save the buyer questions an audit would ask
  models               Print the resolved model registry and its source
  mcp                  Serve audit/verify/gate_check/read_report over MCP (stdio)

Run "saylent <command> --help" for command-specific options.

Docs  ${DOCS_URL}`;
}

/** Plain Levenshtein distance, capped implicitly by the short words involved.
 *  Exported for the unit test. */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const curr = [i, ...new Array<number>(cols - 1).fill(0)];
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[cols - 1];
}

/** The closest command name within two edits, or null. `saylent chek` should
 *  say "Did you mean check?"; `saylent frobnicate` should not guess. */
export function suggestCommand(input: string): string | null {
  let best: { name: string; d: number } | null = null;
  for (const name of [...COMMANDS, ...ALIASES]) {
    const d = editDistance(input.toLowerCase(), name);
    if (d <= 2 && (!best || d < best.d)) best = { name, d };
  }
  return best?.name ?? null;
}

/** The short refusal for an unknown command: name the typo, offer the nearest
 *  command, then the one-line usage — not the whole help screen, which buried
 *  the mistake. */
export function unknownCommandMessage(cmd: string): string {
  const guess = suggestCommand(cmd);
  return [
    `Unknown command "${cmd}".${guess ? ` Did you mean "${guess}"?` : ""}`,
    "",
    "saylent <command> [options]   Commands: " + COMMANDS.join(", "),
    `Run "saylent --help" for the full list.`,
  ].join("\n");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === "--help" || cmd === "-h") {
    process.stdout.write(`${help()}\n`);
    return 0;
  }
  // -V is the conventional capital-V version flag on most CLIs; it used to be
  // reported as an unknown command.
  if (cmd === "--version" || cmd === "-v" || cmd === "-V") {
    process.stdout.write(`${cliVersion()}\n`);
    // A $0 surface — the right place for the one-time star ask (never after a
    // run the user just paid for). It goes to STDERR so that `v=$(saylent
    // --version)` keeps returning nothing but the version.
    maybeStarAsk((line) => process.stderr.write(`${line}\n`));
    return 0;
  }

  switch (cmd) {
    case "audit":
      return (await import("./commands/audit")).run(rest);
    case "verify":
      return (await import("./commands/verify")).run(rest);
    case "gate-check":
    case "check":
      return (await import("./commands/gate-check")).run(rest);
    case "report":
      return (await import("./commands/report")).run(rest);
    case "history":
      return (await import("./commands/history")).run(rest);
    case "keys":
      return (await import("./commands/keys")).run(rest);
    case "questions":
      return (await import("./commands/questions")).run(rest);
    case "models":
      return (await import("./commands/models")).run(rest);
    case "mcp":
      return (await import("./commands/mcp")).run(rest);
    default:
      process.stderr.write(`${unknownCommandMessage(cmd)}\n`);
      return 1;
  }
}

// Only run when executed directly (`node saylent.js`, `tsx src/index.ts`),
// never when this module is imported (e.g. by tests calling main() directly).
const isMain = (() => {
  try {
    // npm installs the binary as a symlink in node_modules/.bin, so argv[1] is the link
    // and import.meta.url is the real file: compare real paths, not the raw strings.
    const invoked = realpathSync(process.argv[1] ?? "");
    const self = realpathSync(fileURLToPath(import.meta.url));
    return invoked === self;
  } catch {
    return false;
  }
})();

if (isMain) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e: unknown) => {
      // Keys must never reach logs or error output. This is the one place every
      // uncaught error in any command surfaces, so it is also the one place
      // every resolved key gets scrubbed out of a message before the terminal.
      const message = e instanceof Error ? e.message : String(e);
      process.stderr.write(`\n  Error     ${redactKnownSecrets(message)}\n`);
      process.exitCode = 1;
    });
}
