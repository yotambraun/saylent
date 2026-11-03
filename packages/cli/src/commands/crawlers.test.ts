// `saylent crawlers` and the MCP `crawlers` tool over a small combined log:
// text summary, --json, --out files, the --run join, refusals, and the MCP
// working-directory guard. No network (verification stays off).
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBundle } from "@saylent/engine/bundle";
import { crawlersTool, resolveInside } from "../mcp/crawlers";
import { run } from "./crawlers";

const UA_GPT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot";
const UA_CLAUDE = "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)";
const LOG = [
  `203.0.113.9 - - [01/Nov/2026:10:00:00 +0000] "GET /pricing?k=1 HTTP/1.1" 200 10 "-" "${UA_GPT}"`,
  `198.51.100.4 - - [02/Nov/2026:09:00:00 +0000] "GET /blog HTTP/1.1" 403 10 "-" "${UA_CLAUDE}"`,
  `192.0.2.10 - - [02/Nov/2026:09:01:00 +0000] "GET / HTTP/1.1" 200 10 "-" "Mozilla/5.0 Chrome/141"`,
].join("\n");

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((c: string) => (out.push(String(c)), true)) as typeof process.stdout.write;
  process.stderr.write = ((c: string) => (err.push(String(c)), true)) as typeof process.stderr.write;
  return {
    out,
    err,
    restore: () => {
      process.stdout.write = o;
      process.stderr.write = e;
    },
  };
}

const dirWithLog = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "saylent-crawlers-"));
  writeFileSync(path.join(dir, "access.log"), LOG);
  return dir;
};

describe("saylent crawlers", () => {
  it("prints the per-bot summary with problems and redacted receipts", async () => {
    const dir = dirWithLog();
    const c = capture();
    const code = await run([path.join(dir, "access.log")]);
    c.restore();
    const text = c.out.join("");
    expect(code).toBe(0);
    // one request each: a tie names no bot "the most"
    expect(text).toContain("2 AI crawlers made 2 requests from 2026-11-01 to 2026-11-02 (UTC).");
    expect(text).not.toContain("the most");
    expect(text).toMatch(/GPTBot\s+Training/);
    expect(text).toContain("/blog  ClaudeBot  Blocked (401/403/429 or firewall)  x1");
    expect(text).toContain("198.51.x.x");
    expect(text).not.toContain("198.51.100.4");
    expect(text).toContain("IP verification is off");
  });

  it("writes crawlers.json and crawlers.md with --out, and prints JSON with --json", async () => {
    const dir = dirWithLog();
    const c = capture();
    await run([path.join(dir, "access.log"), "--out", path.join(dir, "out"), "--json"]);
    c.restore();
    const json = JSON.parse(c.out.join(""));
    expect(json.schema_version).toBe(1);
    expect(JSON.parse(readFileSync(path.join(dir, "out", "crawlers.json"), "utf8")).totals.aiBotHits).toBe(2);
    expect(readFileSync(path.join(dir, "out", "crawlers.md"), "utf8")).toContain("## Bots");
  });

  it("joins with a run.json: cited own pages no AI crawler fetched", async () => {
    const dir = dirWithLog();
    const bundle = JSON.parse(readFileSync(path.resolve(process.cwd(), "examples/kestrel/run.json"), "utf8"));
    const domain = bundle.brand_model.domain as string;
    bundle.answers[0].citations = [{ url: `https://${domain}/pricing`, title: "Pricing" }, { url: `https://${domain}/never`, title: "Never" }];
    bundle.answers[0].ok = true;
    writeFileSync(path.join(dir, "run.json"), JSON.stringify(bundle));
    const c = capture();
    await run([path.join(dir, "access.log"), "--run", path.join(dir, "run.json")]);
    c.restore();
    const text = c.out.join("");
    expect(text, c.err.join("")).toContain("Against the audit's citations");
    expect(text).toMatch(/cited page had no AI-crawler request in this window: .*\/never/);
  }, 90000);

  it("refuses a missing file, a bad date, and an unknown bot", async () => {
    const dir = dirWithLog();
    for (const args of [[path.join(dir, "nope.log")], [path.join(dir, "access.log"), "--since", "yesterday"], [path.join(dir, "access.log"), "--bot", "skynet"]]) {
      const c = capture();
      const code = await run(args);
      c.restore();
      expect(code, args.join(" ")).toBe(1);
      expect(c.err.join("")).toBeTruthy();
    }
  });
});

describe("the MCP crawlers tool", () => {
  it("summarizes a log inside the working directory, never with a raw IP", async () => {
    const dir = dirWithLog();
    const r = await crawlersTool({ log_path: "access.log" }, { cwd: dir, loadBundle: async (f) => readBundle(JSON.parse(readFileSync(f, "utf8"))) });
    expect(r.cost_usd).toBe(0);
    expect((r.bots as { id: string }[]).map((b) => b.id).sort()).toEqual(["claudebot", "gptbot"]);
    expect(JSON.stringify(r)).not.toContain("198.51.100.4");
  }, 90000);

  it("refuses a path outside the working directory", () => {
    const dir = dirWithLog();
    expect(() => resolveInside("../etc/passwd", dir)).toThrow(/inside the server's working directory/);
  });
});
