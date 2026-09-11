// The MCP server itself, driven by a REAL MCP client over a linked in-memory
// transport pair — the same JSON-RPC surface Claude Desktop / Claude Code /
// Cursor speak, minus the pipes. $0: only the two free tools are called, over
// a fake fetcher and the shipped Kestrel bundle, and audit is exercised only
// in its refusal path.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as engineMod from "@saylent/engine";
import type { Fetcher } from "@saylent/engine";
import { loadConfig, mergeConfig } from "@saylent/engine/config";
import * as reportRenderMod from "@saylent/report/render";
import { buildBrief } from "@saylent/report/brief";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reportDataFromBundle } from "../../../report/src/render/from-bundle";
import type { ReportModules } from "../run";
import { createMcpServer, redactedLogger } from "./server";
import { clearRegisteredSecrets, registerSecret } from "../redact";
import type { McpToolDeps } from "./tools";
import { FULL_COST_SENTENCE, SMOKE_COST_SENTENCE } from "../preflight";

// resolved here rather than imported from tools.test.ts: importing another
// test file would register its whole suite a second time inside this one.
const KESTREL_BUNDLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../examples/kestrel/run.json");

const reportMod: ReportModules = {
  reportDataFromBundle,
  renderReportHtml: reportRenderMod.renderReportHtml,
  renderMarkdown: reportRenderMod.renderMarkdown,
  renderMovementHtml: reportRenderMod.renderMovementHtml,
};

const ROBOTS = ["User-agent: GPTBot", "Allow: /", "", "User-agent: ClaudeBot", "Allow: /"].join("\n");
const HOME_HTML =
  `<!doctype html><html><head><title>Acme</title>` +
  `<script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script></head>` +
  `<body><main><h1>Acme Cloud</h1><p>${"edge CDN for platform teams. ".repeat(10)}</p></main></body></html>`;

const fetcher: Fetcher = async (url) => {
  if (url.endsWith("/robots.txt")) return { status: 200, finalUrl: url, text: ROBOTS };
  if (url.endsWith(".xml")) return { status: 404, finalUrl: url, text: "" };
  return { status: 200, finalUrl: url, text: HOME_HTML };
};

const deps: McpToolDeps = {
  run: async () => ({
    engineMod,
    configMod: { loadConfig, mergeConfig },
    reportMod,
    reportDataFromBundle,
    buildBrief,
  }),
  gate: async () => engineMod,
  bundle: async () => ({ readBundle: engineMod.readBundle, reportDataFromBundle, buildBrief }),
  fetcher,
};

let client: Client;
let closeAll: () => Promise<void>;
const prevKeys: Record<string, string | undefined> = {};
const KEY_VARS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "PERPLEXITY_API_KEY"];

beforeEach(async () => {
  for (const k of KEY_VARS) {
    prevKeys[k] = process.env[k];
    delete process.env[k];
  }
  const server = createMcpServer(deps, { version: "0.0.0-test" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "saylent-test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  closeAll = async () => {
    await client.close();
    await server.close();
  };
});

afterEach(async () => {
  await closeAll();
  for (const [k, v] of Object.entries(prevKeys)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function textOf(result: unknown): string {
  const { content } = result as { content: { type: string; text?: string }[] };
  return content.map((c) => c.text ?? "").join("");
}

describe("tools/list", () => {
  it("lists exactly the four tools the MCP server specifies", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["audit", "gate_check", "read_report", "verify"]);
  });

  it("every tool description states its cost", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description ?? "").toMatch(/Cost:/);
    }
    const byName = new Map(tools.map((t) => [t.name, t.description ?? ""]));
    // the two free tools say $0; the two that spend quote the ONE place the
    // price is written (preflight.ts), so a description can never drift from
    // the number the docs and `saylent mcp --help` print
    expect(byName.get("gate_check")).toContain("$0");
    expect(byName.get("read_report")).toContain("$0");
    expect(byName.get("audit")).toContain(SMOKE_COST_SENTENCE);
    expect(byName.get("audit")).toContain(FULL_COST_SENTENCE);
    expect(byName.get("audit")).toContain("23 questions");
    expect(byName.get("verify")).toMatch(/spends YOUR provider credits/);
    expect(byName.get("verify")).toContain(SMOKE_COST_SENTENCE);
  });

  it("tool descriptions and schemas speak of the SUMMARY, never a product name", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const schema = JSON.stringify(tool.inputSchema ?? {});
      expect(`${tool.description ?? ""} ${schema}`).not.toMatch(/\bBrief\b/);
    }
    const byName = new Map(tools.map((t) => [t.name, t.description ?? ""]));
    expect(byName.get("audit")).toContain("the summary blocks as JSON");
    expect(byName.get("verify")).toContain("summary blocks");
    expect(byName.get("read_report")).toContain("Returns the summary blocks");
  });

  it("no tool takes an API key as an argument", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const keys = Object.keys((tool.inputSchema.properties ?? {}) as Record<string, unknown>);
      expect(keys.filter((k) => /key|token|secret/i.test(k))).toEqual([]);
    }
  });
});

describe("tools/call", () => {
  it("gate_check runs end to end over the fake fetcher and returns JSON at $0", async () => {
    const result = await client.callTool({ name: "gate_check", arguments: { domain: "acme.example" } });
    const payload = JSON.parse(textOf(result)) as { result: string; cost_usd: number; report: string };
    expect(payload.cost_usd).toBe(0);
    expect(payload.result).toMatch(/PASS|WARN|FAIL/);
    expect(payload.report).toContain("robots.txt");
  });

  it("read_report returns the Brief blocks of the shipped example bundle at $0", async () => {
    const result = await client.callTool({ name: "read_report", arguments: { bundle_path: KESTREL_BUNDLE } });
    const payload = JSON.parse(textOf(result)) as {
      cost_usd: number;
      summary_blocks: { hero: { headline: string }; cards: { blocks: unknown[] }[] };
    };
    expect(payload.cost_usd).toBe(0);
    expect(payload.summary_blocks.hero.headline.length).toBeGreaterThan(0);
    expect(payload.summary_blocks.cards[0].blocks.length).toBeGreaterThan(0);
  });

  it("audit refuses without keys as a tool error, not a crashed server", async () => {
    const result = (await client.callTool({ name: "audit", arguments: { domain: "acme.example" } })) as {
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/OPENAI_API_KEY/);
    // the connection survives the refusal
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// The safety contract an agent can read from tools/list, and the
// redaction of the one channel (log notifications) that leaves this process
// besides the tool result.
// ---------------------------------------------------------------------------
describe("MCP safety", () => {
  afterEach(() => clearRegisteredSecrets());

  it("#5 audit and verify state the allow_private refusal in their description", async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t.description ?? ""]));
    for (const name of ["audit", "verify"]) {
      expect(byName.get(name)).toMatch(/refuses allow_private/);
      expect(byName.get(name)).toMatch(/SAYLENT_MCP_ALLOW_PRIVATE=1/);
      expect(byName.get(name)).toMatch(/SAYLENT_MCP_ALLOW_ANY_OUT_DIR=1/);
      expect(byName.get(name)).toMatch(/SAYLENT_MCP_ALLOW_EXEC_CONFIG=1/);
    }
  });

  it("#5 the audit tool refuses allow_private over real JSON-RPC, as a tool error", async () => {
    const prev = process.env.SAYLENT_MCP_ALLOW_PRIVATE;
    delete process.env.SAYLENT_MCP_ALLOW_PRIVATE;
    try {
      const result = (await client.callTool({
        name: "audit",
        arguments: { domain: "169.254.169.254", allow_private: true },
      })) as { isError?: boolean };
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/SAYLENT_MCP_ALLOW_PRIVATE=1/);
    } finally {
      if (prev === undefined) delete process.env.SAYLENT_MCP_ALLOW_PRIVATE;
      else process.env.SAYLENT_MCP_ALLOW_PRIVATE = prev;
    }
  });

  it("#19 a log notification is redacted before it is sent", async () => {
    const KEY = "sk-" + "ant-api03-mcp-log-leak-0123456789abcd";
    registerSecret(KEY);
    const sent: string[] = [];
    const log = redactedLogger(async (data) => {
      sent.push(data);
    });
    log(`judge: Anthropic rejected the request (authorization: Bearer ${KEY})`);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain(KEY);
    expect(sent[0]).toContain("[redacted]");
  });

  it("#19 a failing notification never throws into the run", () => {
    const log = redactedLogger(async () => {
      throw new Error("transport gone");
    });
    expect(() => log("progress")).not.toThrow();
  });
});
