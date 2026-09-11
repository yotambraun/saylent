// `saylent mcp`: a stdio Model Context Protocol server exposing audit /
// verify / gate_check / read_report, each stating its own cost in its
// description, each returning the run's summary blocks as JSON.
//
// STDOUT IS THE PROTOCOL. Everything this process prints on stdout is
// JSON-RPC framing owned by StdioServerTransport, so no tool path may write
// there (see tools.ts's rule 2). Progress from a long run goes out as MCP
// `notifications/message` log notifications instead — declared by the
// `logging` capability below, and a no-op for a client that never asked for a
// level.
//
// KEYS ARE NEVER TOOL ARGUMENTS. The agent's server definition provides them
// the way every other Saylent surface does (environment, `.env`,
// ~/.saylent/config.json) — see tools.ts.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { cliVersion } from "../version";
import { redactKnownSecrets } from "../redact";
import {
  loadEngine,
  loadEngineConfig,
  loadGateCheckEngine,
  loadReportFromBundle,
  type GateCheckEngine,
} from "../engine-loader";
// The `audit`/`verify` tool inputSchemas come
// straight from options.ts's shared AuditOptions/VerifyOptions zod schema
// (the SAME schema commands/audit.ts and commands/verify.ts build their
// parseArgs option list from), so this server can never accept a different
// argument set than the CLI accepts flags — see parity.test.ts.
import { AuditOptionsSchema, VerifyOptionsSchema } from "../options";
import { FULL_COST_SENTENCE, SMOKE_COST_SENTENCE } from "../preflight";
import { loadReportModules } from "../run";
import { auditTool, gateCheckTool, readReportTool, verifyTool, type McpToolDeps, type RunDeps } from "./tools";
import type { BundleDeps } from "./tools";

/** Every tool description opens with its cost — an agent must be able to tell
 *  a $0 read from a spend before it calls. The prices come from preflight.ts's
 *  SMOKE_COST_SENTENCE/FULL_COST_SENTENCE, the one place they are written. */
export const TOOL_COSTS = {
  audit: `Cost: spends YOUR provider credits. Smoke profile (6 questions): ${SMOKE_COST_SENTENCE}. Full profile (23 questions): ${FULL_COST_SENTENCE}.`,
  verify: `Cost: spends YOUR provider credits, about the same as the audit it re-runs. Smoke: ${SMOKE_COST_SENTENCE}. Full: ${FULL_COST_SENTENCE}.`,
  gate_check: "Cost: $0. No API keys and no model calls, just live HTTP checks.",
  read_report: "Cost: $0. Reads a run.json already on disk. No network, no model calls.",
} as const;

/** The three MCP-only refusals, stated in the tool description
 *  so an agent learns the boundary from `tools/list` instead of from a failed
 *  call. The guards themselves live in tools.ts. */
const MCP_SAFETY =
  "Safety: this server refuses allow_private (the private-network/SSRF guard stays on) unless it was started with SAYLENT_MCP_ALLOW_PRIVATE=1; " +
  "it refuses an out_dir outside its own working directory unless started with SAYLENT_MCP_ALLOW_ANY_OUT_DIR=1; " +
  "and it reads saylent.config.json only, ignoring executable saylent.config.js/.mjs/.ts unless started with SAYLENT_MCP_ALLOW_EXEC_CONFIG=1.";

const AUDIT_DESCRIPTION = [
  "Run a full AI-answer audit of a brand's domain: crawl the site, model the brand, freeze buyer questions, ask each answer engine, judge the answers cross-family, fetch the cited pages, check the AI bot gates, and draft fixes. Writes run.json, report.html and report.md, and returns the verdict, the recommended band, the summary blocks as JSON, the written file paths and the real cost.",
  TOOL_COSTS.audit,
  "Provider keys are read from the environment, a .env file, or ~/.saylent/config.json; they can never be passed as arguments. The estimate is checked against max_usd (and the daily spend cap) BEFORE anything is sent to a provider, and refuses with the same message the CLI prints.",
  "Pass dry_run: true for a $0, no-keys, no-network preflight instead: the question set (template defaults, or questions_file/questions when given) and the cost estimate, nothing sent to any provider.",
  MCP_SAFETY,
].join(" ");

const VERIFY_DESCRIPTION = [
  "Re-run the SAME frozen questions of an existing run.json and show what moved. Use this after shipping fixes. Writes a new run.json plus movement.html and returns the new verdict, band and summary blocks.",
  TOOL_COSTS.verify,
  "The estimate is checked against max_usd (and the daily spend cap) BEFORE anything is sent to a provider, same as `audit`.",
  "Refuses when the question templates or the sample count have drifted since the baseline, so a comparison is never made against a different question library.",
  MCP_SAFETY,
].join(" ");

const GATE_CHECK_DESCRIPTION = [
  "Check what AI bots a site actually lets in: robots.txt per bot class (training, search, user), a live per-user-agent probe that catches CDN or WAF blocks robots.txt does not mention, JSON-LD presence, and meta directives.",
  TOOL_COSTS.gate_check,
  "Returns the same PASS/WARN/FAIL block the `saylent gate-check` command prints, plus its exit code (1 when a check fails).",
].join(" ");

const READ_REPORT_DESCRIPTION = [
  "Read an audit that already ran. Returns the summary blocks (hero, verdict, and the receipt-linked question cards) as JSON from a run.json bundle, or one named section when `section` is given — including `section: \"questions\"`, the run's frozen question set.",
  TOOL_COSTS.read_report,
  "Call this instead of `audit` whenever a report for this brand already exists.",
].join(" ");

const auditInput = AuditOptionsSchema.shape;
const verifyInput = VerifyOptionsSchema.shape;

const gateCheckInput = {
  domain: z.string().describe("The domain to check, for example example.com"),
};

const readReportInput = {
  bundle_path: z.string().describe("Path to a run.json (or the directory containing it)"),
  section: z
    .string()
    .optional()
    .describe(
      'One section of the summary, by card id or anchor (for example "hero"), or "questions" for the run\'s frozen question set. Omit for the whole summary.',
    ),
};

type ToolTextResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/** One JSON payload per call, plus the error contract: a refusal (missing
 *  keys, max_usd below the estimate, an unreadable bundle) comes back as an
 *  isError result carrying the CLI's own wording, never as a crashed server.
 *  Every message is passed through the key redactor first. */
async function jsonResult(work: () => Promise<unknown>): Promise<ToolTextResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await work(), null, 2) }] };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text", text: redactKnownSecrets(message) }], isError: true };
  }
}

/** Every MCP log notification passes through key redaction first. A
 *  progress line carries stage detail built from provider output, and log
 *  notifications are the one channel besides the tool result that leaves this
 *  process. Exported so the redaction is directly testable without a
 *  transport. Failures are swallowed: a notification must never take a run
 *  down. */
export function redactedLogger(send: (data: string) => Promise<unknown>): (message: string) => void {
  return (message: string): void => {
    void send(redactKnownSecrets(message)).catch(() => {});
  };
}

export interface CreateServerOptions {
  /** name/version reported in the MCP handshake */
  version?: string;
}

/** Build the server over injected dependencies (tests pass statically
 *  imported modules and fake pipelines; `createSaylentMcpServer` passes the
 *  lazily loaded real ones). */
export function createMcpServer(deps: McpToolDeps, opts: CreateServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: "saylent", version: opts.version ?? cliVersion() },
    {
      capabilities: { logging: {} },
      instructions:
        "Saylent audits what AI assistants say about a brand. gate_check and read_report are free; audit and verify spend the user's own provider credits, so state the cost and get agreement before calling them.",
    },
  );

  // Progress -> MCP log notifications when the transport is up. Wrapped
  // because a notification must never take a run down.
  const log = redactedLogger((data) =>
    server.sendLoggingMessage({ level: "info", logger: "saylent", data }),
  );
  const withLog: McpToolDeps = { ...deps, log: deps.log ?? log };

  server.registerTool(
    "audit",
    { title: "Run an AI answer audit", description: AUDIT_DESCRIPTION, inputSchema: auditInput },
    async (args) => jsonResult(() => auditTool(withLog, args)),
  );

  server.registerTool(
    "verify",
    { title: "Re-run a frozen audit and show movement", description: VERIFY_DESCRIPTION, inputSchema: verifyInput },
    async (args) => jsonResult(() => verifyTool(withLog, args)),
  );

  server.registerTool(
    "gate_check",
    {
      title: "Check AI bot access for a site",
      description: GATE_CHECK_DESCRIPTION,
      inputSchema: gateCheckInput,
      annotations: { readOnlyHint: true },
    },
    async (args) => jsonResult(() => gateCheckTool(withLog, args)),
  );

  server.registerTool(
    "read_report",
    {
      title: "Read an existing audit report",
      description: READ_REPORT_DESCRIPTION,
      inputSchema: readReportInput,
      annotations: { readOnlyHint: true },
    },
    async (args) => jsonResult(() => readReportTool(withLog, args)),
  );

  return server;
}

/** The real, lazily loaded dependency set: a `gate_check` call never pays for
 *  llm.ts's provider SDK imports, and a `read_report` never loads the
 *  pipeline (same split engine-loader.ts documents for the CLI commands). */
export function realDeps(): McpToolDeps {
  let runDeps: Promise<RunDeps> | null = null;
  let gateDeps: Promise<GateCheckEngine> | null = null;
  let bundleDeps: Promise<BundleDeps> | null = null;
  return {
    run: () => {
      if (!runDeps) {
        runDeps = Promise.all([
          loadEngine(),
          loadEngineConfig(),
          loadReportModules(),
          loadReportFromBundle(),
          import("@saylent/report/brief"),
        ]).then(([engineMod, configMod, reportMod, fromBundle, briefMod]) => ({
          engineMod,
          configMod,
          reportMod,
          reportDataFromBundle: fromBundle.reportDataFromBundle,
          buildBrief: briefMod.buildBrief,
        }));
      }
      return runDeps;
    },
    gate: () => {
      if (!gateDeps) gateDeps = loadGateCheckEngine();
      return gateDeps;
    },
    bundle: () => {
      if (!bundleDeps) {
        bundleDeps = Promise.all([
          import("@saylent/engine/bundle"),
          loadReportFromBundle(),
          import("@saylent/report/brief"),
        ]).then(([bundleMod, fromBundle, briefMod]) => ({
          readBundle: bundleMod.readBundle,
          reportDataFromBundle: fromBundle.reportDataFromBundle,
          buildBrief: briefMod.buildBrief,
        }));
      }
      return bundleDeps;
    },
  };
}

export function createSaylentMcpServer(): McpServer {
  return createMcpServer(realDeps());
}

/** Serve on stdio and stay connected until the client closes the stream. */
export async function startStdioServer(server: McpServer = createSaylentMcpServer()): Promise<void> {
  await server.connect(new StdioServerTransport());
}
