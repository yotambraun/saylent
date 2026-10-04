// The Claude Code plugin (plugins/saylent + .claude-plugin/marketplace.json)
// drives this package's MCP server and CLI. These tests keep the two in step:
// a renamed tool, a new provider key, a removed command or a new major
// version fails here instead of in a user's session.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "./index";
import { PROVIDERS } from "./keys";
import { TOOL_COSTS } from "./mcp/server";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const readJson = (rel: string) => JSON.parse(readFileSync(path.join(repoRoot, rel), "utf8")) as Record<string, unknown>;

const marketplace = readJson(".claude-plugin/marketplace.json") as {
  name: string;
  plugins: { name: string; source: string }[];
};
const pluginEntry = marketplace.plugins.find((p) => p.name === "saylent");
const pluginDir = pluginEntry ? path.posix.normalize(pluginEntry.source) : "plugins/saylent";
const plugin = readJson(`${pluginDir}/.claude-plugin/plugin.json`) as { name: string; version: string };
const mcp = readJson(`${pluginDir}/.mcp.json`) as {
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
};
const cliVersion = (readJson("packages/cli/package.json") as { version: string }).version;

const skillsDir = path.join(repoRoot, pluginDir, "skills");
const skills = readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => {
    // Normalize line endings: Git on Windows checks files out with CRLF.
    const text = readFileSync(path.join(skillsDir, d.name, "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
    const fm = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    const field = (name: string) => (fm ? new RegExp(`^${name}:\\s*(.+)$`, "m").exec(fm[1])?.[1].trim() : undefined);
    return { dir: d.name, text, body: fm?.[2] ?? "", name: field("name"), description: field("description"), allowedTools: field("allowed-tools") };
  });

describe("Claude Code plugin", () => {
  it("is listed in the saylent marketplace under the same name its manifest uses", () => {
    expect(marketplace.name).toBe("saylent");
    expect(pluginEntry).toBeDefined();
    expect(plugin.name).toBe(pluginEntry?.name);
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("starts the saylent MCP server with npx, on the CLI's current major line", () => {
    const server = mcp.mcpServers.saylent;
    expect(server.command).toBe("npx");
    expect(server.args[server.args.length - 1]).toBe("mcp");
    const spec = server.args.find((a) => a.startsWith("saylent"));
    expect(spec).toBe(`saylent@${cliVersion.split(".")[0]}`);
  });

  it("passes every provider key the CLI reads, empty when unset, and nothing else", () => {
    const env = mcp.mcpServers.saylent.env ?? {};
    const expected = Object.fromEntries(PROVIDERS.map((p) => [p.envVar, `\${${p.envVar}:-}`]));
    expect(env).toEqual(expected);
  });

  it("ships the four skills, each with a matching name, a description and a short body", () => {
    expect(skills.map((s) => s.dir).sort()).toEqual(["audit", "gate-check", "read-report", "verify"]);
    for (const s of skills) {
      expect(s.name, s.dir).toBe(s.dir);
      expect(s.description?.length ?? 0, s.dir).toBeGreaterThan(80);
      expect(s.description?.length ?? 0, s.dir).toBeLessThanOrEqual(1536);
      expect(s.body.split("\n").length, s.dir).toBeLessThan(150);
    }
  });

  it("names only MCP tools the server registers", () => {
    const tools = new Set(Object.keys(TOOL_COSTS));
    for (const s of skills) {
      for (const m of s.text.matchAll(/the `([a-z_]+)` tool of the saylent MCP server/g)) {
        expect(tools.has(m[1]), `${s.dir}: ${m[1]}`).toBe(true);
      }
      for (const t of (s.allowedTools ?? "").split(/[\s,]+/).filter(Boolean)) {
        const m = /^mcp__plugin_saylent_saylent__([a-z_]+)$/.exec(t);
        expect(m, `${s.dir}: ${t}`).not.toBeNull();
        expect(tools.has(m?.[1] ?? ""), `${s.dir}: ${t}`).toBe(true);
      }
    }
  });

  it("pre-approves only the free, read-only tools", () => {
    const approved = skills.flatMap((s) => (s.allowedTools ?? "").split(/[\s,]+/).filter(Boolean));
    for (const t of approved) expect(t).toMatch(/__(gate_check|read_report)$/);
  });

  it("uses only real CLI commands in its shell fallbacks, on the same major line", () => {
    const commands = new Set<string>(COMMANDS);
    for (const s of skills) {
      for (const m of s.text.matchAll(/npx (?:-y )?(saylent(?:@[\w.]+)?) ([a-z-]+)/g)) {
        expect(commands.has(m[2]), `${s.dir}: ${m[0]}`).toBe(true);
        if (m[1].includes("@")) expect(m[1], `${s.dir}: ${m[0]}`).toBe(`saylent@${cliVersion.split(".")[0]}`);
      }
    }
  });
});
