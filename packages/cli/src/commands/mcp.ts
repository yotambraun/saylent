// `saylent mcp` — the stdio MCP server, so an agent that already has Saylent
// installed can audit, verify, gate-check and read a report without a human at
// a terminal. The server itself lives in ../mcp/server.ts; this file is only
// the argv door.
//
// The process deliberately does not return after connecting: the stdio
// transport owns stdin/stdout for the life of the session and exits with the
// client. Nothing here may print to stdout except --help (which never starts
// a server).
import { parseArgs } from "node:util";
import { startStdioServer } from "../mcp/server";
import { FULL_COST_SENTENCE, SMOKE_COST_SENTENCE } from "../preflight";
import { HELP_OPTION } from "../help";

const HELP = `saylent mcp

Runs a Model Context Protocol server on stdio. Point an MCP client at it
("claude mcp add saylent -- npx saylent mcp", or a claude_desktop_config.json
/ Cursor mcp.json entry) and the agent gets four tools:

  audit        run a full audit          spends your credits
  verify       re-run the frozen set     spends your credits (same as the audit)
  gate_check   AI bot access for a site  $0
  read_report  read an existing run.json $0

A smoke audit costs ${SMOKE_COST_SENTENCE}.
A full audit costs ${FULL_COST_SENTENCE}.

Provider keys come from the environment, a .env in the working directory, or
~/.saylent/config.json — an agent can never pass a key as a tool argument.

Options:
${HELP_OPTION}`;

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  parseArgs({ args: argv, allowPositionals: false, options: {} });
  await startStdioServer();
  return 0;
}
