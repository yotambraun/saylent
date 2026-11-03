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
import { auditTool, gateCheckTool, readReportTool, resolveBundlePath, sourcesTool, verifyTool, type McpToolDeps, type RunDeps } from "./tools";
import { SOURCE_VIEWS } from "./sources";
import { DOMAIN_TYPES } from "@saylent/engine/sources";
import { EXPORT_TABLES, type ExportTable } from "@saylent/report/data-export";
import type { BundleDeps } from "./tools";

/** Every tool description opens with its cost — an agent must be able to tell
 *  a $0 read from a spend before it calls. The prices come from preflight.ts's
 *  SMOKE_COST_SENTENCE/FULL_COST_SENTENCE, the one place they are written. */
export const TOOL_COSTS = {
  audit: `Cost: spends YOUR provider credits. Smoke profile (6 questions): ${SMOKE_COST_SENTENCE}. Full profile (23 questions): ${FULL_COST_SENTENCE}.`,
  verify: `Cost: spends YOUR provider credits, about the same as the audit it re-runs. Smoke: ${SMOKE_COST_SENTENCE}. Full: ${FULL_COST_SENTENCE}.`,
  gate_check: "Cost: $0. No API keys and no model calls, just live HTTP checks.",
  read_report: "Cost: $0. Reads a run.json already on disk. No network, no model calls.",
  sources: "Cost: $0. Reads a run.json already on disk. No network, no model calls.",
  crawlers: "Cost: $0. Reads an access log already on disk; no model calls. Network only with verify_ips (GETs the operators' public IP-range files).",
  questions_import: "Cost: $0. Reads a file already on disk. No network, no model calls, writes nothing.",
  history: "Cost: $0. Reads run.json files already on disk. No network, no model calls.",
  export: "Cost: $0. Reads run.json files already on disk. No network, no model calls; writes files only with out_dir.",
  fixes: "Cost: $0. Reads a run.json already on disk. No network, no model calls, writes nothing.",
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
  "Pass dry_run: true for a $0, no-keys, no-network preflight instead: the question set (template defaults, or questions_file/questions when given), which providers have a key (presence only, never a value), whether a real run would start, and the cost estimate for the engines that would run, nothing sent to any provider. Call it before every audit.",
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

const SOURCES_DESCRIPTION = [
  "Where an existing audit's answers come from, as counts with receipts: citation share by domain (per engine and answer surface), who the answers name (share of voice as answer counts), and the off-site opportunities, domains cited in answers that name a rival and not the brand (non-branded questions), where the brand was not found on any page read, ranked by how many such answers cite them. Every domain carries its type and the rule that set it; every opportunity carries receipts (question, engine, cited URLs, the rivals named and a quote).",
  TOOL_COSTS.sources,
  'view: "summary" (default), "opportunities", "domains", "voice" or "all". Filter with engine (e.g. "google_ai_overview") or type (e.g. "review_site"), or pass domain for one domain\'s pages and every answer citing it.',
].join(" ");

const CRAWLERS_DESCRIPTION = [
  "Which AI crawlers actually visit a site, from its own access log (nginx/Apache combined, Vercel log drains, Cloudflare Logpush; .gz and directories too): requests per bot (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, Googlebot, Bingbot and more) with each bot's purpose (training, search index, user-triggered fetch), the pages they fetched, and the requests that were blocked or failed, each with a redacted log line as its receipt. It also counts visits from people that AI assistants sent (ai_referrals), by Referer host or utm_source: a floor, since many such visits carry neither.",
  TOOL_COSTS.crawlers,
  "Pass run_path (a run.json) to list the pages the audit's answers cite that no AI crawler fetched in the log window. log_path and run_path must be inside this server's working directory. Client IPs are always redacted.",
].join(" ");

const crawlersInput = {
  log_path: z.string().describe("Access log file or directory, inside the working directory"),
  run_path: z.string().optional().describe("A run.json to join with: cited pages no AI crawler fetched"),
  verify_ips: z.boolean().optional().describe("Check IPs against the operators' published ranges (fetches public JSON files)"),
  since: z.string().optional().describe("ISO date: only requests on or after it"),
  until: z.string().optional().describe("ISO date: only requests up to it"),
  limit: z.number().int().min(1).max(50).optional().describe("Rows per list (default 10)"),
};

const QUESTIONS_IMPORT_DESCRIPTION = [
  "Preview turning real search queries into audit questions: reads a Google Search Console Performance export (the Queries.csv in its ZIP), any CSV (name the column), or text lines; normalizes, filters, deduplicates and optionally clusters them by stated rules, ranks by impressions, and returns what would be kept and how many rows were dropped for each reason.",
  TOOL_COSTS.questions_import,
  "It writes nothing: to keep the set, the user runs `saylent questions import` with the same options and passes the questions.json to `audit` (questions_file). file_path must be inside this server's working directory.",
].join(" ");

const questionsImportInput = {
  file_path: z.string().describe("Queries.csv, a CSV or a text file, inside the working directory"),
  format: z.enum(["gsc", "csv", "text"]).optional().describe("Default: detected"),
  column: z.string().optional().describe("CSV: the column holding the queries, by name or 1-based number"),
  min_impressions: z.number().min(0).optional().describe("Search Console: drop queries seen fewer times"),
  exclude: z.array(z.string()).optional().describe("Regular expressions; matching rows are dropped (e.g. the brand name)"),
  include: z.array(z.string()).optional().describe("Regular expressions; only matching rows are kept"),
  questions_only: z.boolean().optional().describe("Keep question-shaped rows only"),
  cluster: z.boolean().optional().describe("Merge near-identical queries"),
  max: z.number().int().min(1).max(50).optional().describe("How many to keep (default 20)"),
  language: z.string().optional().describe("The set's language, BCP 47 (e.g. de)"),
  country: z.string().optional().describe("The set's country, two letters (e.g. de)"),
};

const HISTORY_DESCRIPTION = [
  "Compare two or more runs of one brand: each run's recommended and mentioned counts (overall and per engine), and what moved between the oldest and the newest as events with receipts (recommendations gained or lost per question and engine, rivals no earlier answer named, new off-site opportunities), plus citations per domain per run. The events are the same rules `verify --notify` and the weekly digest use.",
  TOOL_COSTS.history,
  "bundle_paths takes run.json files, run folders, or a brand folder holding <YYYY-MM-DD>/run.json. Movement after a fix is correlation, not proof; say so when you report it.",
].join(" ");

const historyInput = {
  bundle_paths: z.array(z.string()).min(1).describe("run.json files, run folders, or a brand folder of <YYYY-MM-DD>/run.json"),
};

const EXPORT_DESCRIPTION = [
  "Export runs as the documented, versioned tables (saylent.export/v1): runs, answers, citations, sources, opportunities, share_of_voice, fixes, crawlers (from a crawlers.json) and search_queries (the web searches ChatGPT, Claude and Gemini reported running). Without out_dir it returns one table inline (default runs, up to limit rows); with out_dir it writes CSV files or export.json and returns the paths.",
  TOOL_COSTS.export,
  "out_dir and crawlers_path must be inside this server's working directory (out_dir unless started with SAYLENT_MCP_ALLOW_ANY_OUT_DIR=1). Columns: https://yotambraun.github.io/saylent/docs/export",
].join(" ");

const exportInput = {
  bundle_paths: z.array(z.string()).min(1).describe("run.json files, run folders, or a brand folder of <YYYY-MM-DD>/run.json"),
  crawlers_path: z.string().optional().describe("A crawlers.json from `saylent crawlers --out`, inside the working directory"),
  table: z.enum(EXPORT_TABLES as [ExportTable, ...ExportTable[]]).optional().describe("One table (default: runs inline, every table with out_dir)"),
  format: z.enum(["json", "csv"]).optional().describe("Default json"),
  out_dir: z.string().optional().describe("Write files here instead of returning rows"),
  limit: z.number().int().min(1).max(1000).optional().describe("Rows returned inline (default 100)"),
};

const FIXES_DESCRIPTION = [
  "The fixes a run drafted, ranked by weight, each with the evidence lines the diagnosis recorded (the receipts), the engines it concerns, its effort, and whether it is a site change `saylent fixes apply` can write into a repository (robots.txt groups, JSON-LD) or other work (outreach, content). Pass fix (a fix_key from the list) for one fix with its full drafted artifact.",
  TOOL_COSTS.fixes,
  "Drafts are drafts: values marked TODO-VERIFY must be checked before anything ships. To put the site fixes on a branch, the user runs `saylent fixes apply <run.json> --repo <path>` in a terminal; it shows a diff, asks, commits locally and never pushes.",
].join(" ");

const fixesInput = {
  bundle_path: z.string().describe("Path to a run.json (or the directory containing it)"),
  fix: z.string().optional().describe("One fix by its id (fix_key in the list), with its full drafted artifact"),
};

const sourcesInput = {
  bundle_path: z.string().describe("Path to a run.json (or the directory containing it)"),
  view: z.enum(SOURCE_VIEWS).optional().describe('"summary" (default), "opportunities", "domains", "voice" or "all"'),
  engine: z.string().optional().describe("Keep only rows cited by this engine or answer surface id"),
  type: z.enum(DOMAIN_TYPES).optional().describe("Keep only domains of this type"),
  domain: z.string().optional().describe("One domain's detail: its pages and every answer citing it"),
  limit: z.number().int().min(1).max(50).optional().describe("Rows per list (default 10)"),
};

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
        "Saylent audits what AI assistants say about a brand. gate_check, read_report, sources, fixes, history, export, crawlers and questions_import are free; audit and verify spend the user's own provider credits, so state the cost (audit with dry_run: true is the free estimate) and get agreement before calling them. Saylent measures and returns receipts; you do the reasoning, and every claim you make should point at a receipt it returned.",
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

  server.registerTool(
    "sources",
    {
      title: "Query an audit's sources and off-site opportunities",
      description: SOURCES_DESCRIPTION,
      inputSchema: sourcesInput,
      annotations: { readOnlyHint: true },
    },
    async (args) => jsonResult(() => sourcesTool(withLog, args)),
  );

  server.registerTool(
    "crawlers",
    {
      title: "AI crawler activity from an access log",
      description: CRAWLERS_DESCRIPTION,
      inputSchema: crawlersInput,
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      jsonResult(async () => {
        const { crawlersTool } = await import("./crawlers");
        const { loadBundleFileAsync } = await import("../run");
        return crawlersTool(args, { loadBundle: loadBundleFileAsync });
      }),
  );

  server.registerTool(
    "questions_import",
    {
      title: "Preview importing real questions",
      description: QUESTIONS_IMPORT_DESCRIPTION,
      inputSchema: questionsImportInput,
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      jsonResult(async () => {
        const { questionsImportTool } = await import("./questions-import");
        return questionsImportTool(args);
      }),
  );

  server.registerTool(
    "history",
    { title: "Compare runs of one brand", description: HISTORY_DESCRIPTION, inputSchema: historyInput, annotations: { readOnlyHint: true } },
    async (args) =>
      jsonResult(async () => {
        const { historyTool } = await import("./history");
        const { loadBundleFileAsync } = await import("../run");
        return historyTool(args, { loadBundle: loadBundleFileAsync });
      }),
  );

  server.registerTool(
    "export",
    { title: "Export run data as tables", description: EXPORT_DESCRIPTION, inputSchema: exportInput },
    async (args) =>
      jsonResult(async () => {
        const { exportTool } = await import("./export");
        const { loadBundleFileAsync } = await import("../run");
        return exportTool(args, { loadBundle: loadBundleFileAsync });
      }),
  );

  server.registerTool(
    "fixes",
    { title: "The drafted fixes, with their evidence", description: FIXES_DESCRIPTION, inputSchema: fixesInput, annotations: { readOnlyHint: true } },
    async (args) =>
      jsonResult(async () => {
        const { fixesPayload } = await import("../fixes-apply");
        const { loadBundleFileAsync } = await import("../run");
        const bundle = await loadBundleFileAsync(resolveBundlePath(args.bundle_path));
        return { bundle_path: resolveBundlePath(args.bundle_path), ...fixesPayload(bundle, { fixKey: args.fix }) };
      }),
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
