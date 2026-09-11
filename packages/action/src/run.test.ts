// runGateCheck against a fake fetcher — no keys, no LLM, $0. Mirrors
// packages/cli/src/commands/gate-check.test.ts: @saylent/engine is imported
// STATICALLY (a dynamic import() of it was measured to hang under vitest — see that
// file's note), and the fake Fetcher bypasses safeFetch's real network + DNS-rebind
// guard, which would reject a fictional test domain before any mock ever ran.
import * as engineMod from "@saylent/engine";
import type { Fetcher } from "@saylent/engine";
import { describe, expect, it } from "vitest";
import { runGateCheck, withSiteRoot } from "./run";

const ROBOTS = [
  "User-agent: GPTBot",
  "Disallow: /",
  "",
  "User-agent: ClaudeBot",
  "Allow: /",
  "",
  "User-agent: OAI-SearchBot",
  "Allow: /",
].join("\n");

const HOME_HTML =
  `<!doctype html><html><head><title>Acme</title>` +
  `<script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>` +
  `</head><body><main><h1>Acme Cloud</h1><p>${"edge CDN for platform teams. ".repeat(10)}</p></main></body></html>`;

function makeFetcher(opts: { blockClaudeBot?: boolean } = {}): Fetcher {
  return async (url, fetchOpts) => {
    if (url.endsWith("/robots.txt")) return { status: 200, finalUrl: url, text: ROBOTS };
    if (url.endsWith(".xml")) return { status: 404, finalUrl: url, text: "" };
    if (opts.blockClaudeBot && fetchOpts?.ua?.includes("ClaudeBot")) {
      return { status: 403, finalUrl: url, text: "blocked" };
    }
    return { status: 200, finalUrl: url, text: HOME_HTML };
  };
}

describe("withSiteRoot", () => {
  it("passes a bare domain through unchanged", () => {
    expect(withSiteRoot("example.com")).toBe("example.com");
  });

  it("joins a site_root path, with or without a leading slash", () => {
    expect(withSiteRoot("example.com", "/docs")).toBe("example.com/docs");
    expect(withSiteRoot("example.com", "docs")).toBe("example.com/docs");
    expect(withSiteRoot("example.com/", "/docs")).toBe("example.com/docs");
  });
});

describe("runGateCheck (real engine logic, fake fetcher, $0)", () => {
  it("fails the 'training' class on a robots.txt block, and reports it a legitimate choice", async () => {
    const result = await runGateCheck(engineMod, "acme.example", { fetcher: makeFetcher() });
    const training = result.classes.find((c) => c.kind === "training")!;
    expect(training.status).toBe("warn");
    expect(training.findings.some((f) => f.includes("GPTBot") && f.includes("legitimate choice"))).toBe(true);
  });

  it("fails the 'training' class's live-probe row (not job-fail scope) when a CDN blocks GPTBot/ClaudeBot despite robots.txt allowing it", async () => {
    const result = await runGateCheck(engineMod, "acme.example", { fetcher: makeFetcher({ blockClaudeBot: true }) });
    const training = result.classes.find((c) => c.kind === "training")!;
    expect(training.status).toBe("fail");
    expect(training.findings.some((f) => f.includes("ClaudeBot") && f.includes("live probe"))).toBe(true);
    expect(result.overall).toBe("fail");
  });

  it("passes clean when nothing is blocked", async () => {
    const result = await runGateCheck(engineMod, "clean.example", { fetcher: makeFetcher() });
    expect(result.domain).toBe("clean.example");
    expect(result.classes.every((c) => c.status !== "fail")).toBe(true);
  });

  it("records elapsed time", async () => {
    const result = await runGateCheck(engineMod, "clean.example", { fetcher: makeFetcher() });
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
