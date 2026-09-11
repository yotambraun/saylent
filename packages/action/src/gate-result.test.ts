// Pure-reducer tests: a fake DomainCheck[] (the shape @saylent/engine's
// runDomainChecks() actually returns) in, a GateResult out. No network, no engine
// call — this is the "fake gate result" fixture the DONE-CHECK asks for.
import type { BotSpec } from "@saylent/engine/domainChecks";
import type { DomainCheck } from "@saylent/engine/types";
import { describe, expect, it } from "vitest";
import { computeGateResult } from "./gate-result";

// A trimmed stand-in for BOT_REGISTRY — only what the reducer needs (agent + kind).
const REGISTRY: BotSpec[] = [
  { agent: "GPTBot", kind: "training", impact: "feeds future OpenAI model weights; blocking is a legitimate choice" },
  { agent: "ClaudeBot", kind: "training", impact: "feeds future Anthropic model weights; blocking is a legitimate choice" },
  { agent: "OAI-SearchBot", kind: "search", impact: "blocking removes ChatGPT-search citation eligibility" },
  { agent: "PerplexityBot", kind: "search", impact: "blocking removes Perplexity citation eligibility" },
  { agent: "ChatGPT-User", kind: "user", impact: "blocking kills live page reads" },
];

describe("computeGateResult (pure reducer over a fake DomainCheck[])", () => {
  it("classifies robots + live-probe checks into training/search/user rows", () => {
    const checks: DomainCheck[] = [
      { check: "robots: GPTBot", status: "warn", detail: "blocked — feeds future OpenAI model weights; blocking is a legitimate choice" },
      { check: "robots: OAI-SearchBot", status: "pass", detail: "allowed" },
      { check: "robots: ChatGPT-User", status: "pass", detail: "allowed" },
      { check: "live fetch as ClaudeBot", status: "pass", detail: "HTTP 200" },
      { check: "JSON-LD Organization", status: "pass", detail: "present" },
    ];
    const result = computeGateResult(checks, REGISTRY, "acme.example", 1234);

    expect(result.domain).toBe("acme.example");
    expect(result.elapsedMs).toBe(1234);
    expect(result.classes.map((c) => c.kind)).toEqual(["training", "search", "user"]);

    const training = result.classes.find((c) => c.kind === "training")!;
    expect(training.status).toBe("warn");
    expect(training.findings.some((f) => f.includes("GPTBot") && f.includes("legitimate choice"))).toBe(true);

    expect(result.classes.find((c) => c.kind === "search")!.status).toBe("pass");
    expect(result.classes.find((c) => c.kind === "user")!.status).toBe("pass");

    // JSON-LD is not a bot check — it lands in `other`, never a class row.
    expect(result.other.some((o) => o.check === "JSON-LD Organization")).toBe(true);
  });

  it("a search-index or user-fetch block is FAIL on that class; overall reflects the worst status", () => {
    const checks: DomainCheck[] = [
      { check: "robots: ClaudeBot", status: "pass", detail: "allowed" },
      { check: "robots: PerplexityBot", status: "fail", detail: "blocked — search citation eligibility lost" },
      { check: "live fetch as ChatGPT-User", status: "fail", detail: "HTTP 403 while robots.txt allows it" },
      { check: "JSON-LD Organization", status: "pass", detail: "present" },
    ];
    const result = computeGateResult(checks, REGISTRY, "blocked.example", 500);

    expect(result.classes.find((c) => c.kind === "search")!.status).toBe("fail");
    expect(result.classes.find((c) => c.kind === "user")!.status).toBe("fail");
    expect(result.classes.find((c) => c.kind === "training")!.status).toBe("pass");
    expect(result.overall).toBe("fail");
  });

  it("info-status checks never move a class or the overall result", () => {
    const checks: DomainCheck[] = [
      { check: "robots: Google-Extended", status: "info", detail: "not mentioned" },
      { check: "live-fetch caveat", status: "info", detail: "server logs are ground truth" },
      { check: "robots: ClaudeBot", status: "pass", detail: "allowed" },
    ];
    const result = computeGateResult(checks, REGISTRY, "clean.example", 10);
    expect(result.overall).toBe("pass");
    expect(result.other).toHaveLength(2);
  });

  it("a class with no matching checks defaults to pass with an empty findings list", () => {
    const result = computeGateResult([], REGISTRY, "empty.example", 0);
    for (const row of result.classes) {
      expect(row.status).toBe("pass");
      expect(row.findings).toHaveLength(0);
    }
    expect(result.overall).toBe("pass");
  });
});
