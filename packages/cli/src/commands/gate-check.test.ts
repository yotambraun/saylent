// gate-check against a fake fetcher — no keys, no LLM, $0. @saylent/engine is
// imported STATICALLY (see run.test.ts's note: a dynamic import() of
// @saylent/engine was measured to hang under vitest specifically), and its
// real crawlSite/runDomainChecks run for real against a fake Fetcher (the
// same injection point run-audit.test.ts uses — bypassing safeFetch's real
// network + DNS-rebind guard, which would reject a fictional test domain
// before ever reaching a mocked global fetch).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as engineMod from "@saylent/engine";
import type { Fetcher } from "@saylent/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT_UNREACHABLE, run, runGateCheckWith, summarizeChecks } from "./gate-check";

// The star ask writes a marker under $HOME/.saylent — redirect HOME so these
// tests never touch the developer's real one.
let home: string;
let prevHome: string | undefined;
beforeEach(() => {
  prevHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "saylent-gate-home-"));
  process.env.HOME = home;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  process.env.HOME = prevHome;
});

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

describe("runGateCheckWith (real engine logic, fake fetcher, $0)", () => {
  it("prints robots/live-probe/JSON-LD/meta lines and fails on a real access-blocked finding", async () => {
    const lines: string[] = [];
    const code = await runGateCheckWith(
      engineMod,
      "acme.example",
      (l) => lines.push(l),
      makeFetcher({ blockClaudeBot: true }),
    );
    const out = lines.join("");

    expect(out).toContain("robots.txt");
    expect(out).toContain("live probe");
    expect(out).toContain("JSON-LD");
    expect(out).toContain("meta");
    expect(out).toContain("Result");
    // ClaudeBot: robots.txt allows it, but the live probe 403s — the exact
    // "CDN/WAF override" access_blocked finding domainChecks.ts fails on.
    expect(out).toMatch(/ClaudeBot 403/);
    expect(code).toBe(1);
  });

  it("passes clean when nothing is blocked", async () => {
    const lines: string[] = [];
    const code = await runGateCheckWith(engineMod, "clean.example", (l) => lines.push(l), makeFetcher());
    expect(code).toBe(0);
    expect(lines.join("")).toContain("Result");
  });

  it("asks for a star on the FIRST clean run only — a $0 surface, never after a paid audit", async () => {
    const first: string[] = [];
    await runGateCheckWith(engineMod, "clean.example", (l) => first.push(l), makeFetcher());
    expect(first.join("")).toContain("Star the repo");

    const second: string[] = [];
    await runGateCheckWith(engineMod, "clean.example", (l) => second.push(l), makeFetcher());
    expect(second.join("")).not.toContain("Star the repo");
  });

  it("never asks for a star on a FAILING run", async () => {
    const lines: string[] = [];
    const code = await runGateCheckWith(
      engineMod,
      "acme.example",
      (l) => lines.push(l),
      makeFetcher({ blockClaudeBot: true }),
    );
    expect(code).toBe(1);
    expect(lines.join("")).not.toContain("Star the repo");
  });
});

describe("gate-check command argv handling (no network)", () => {
  it("--help exits 0 and never calls loadEngine", async () => {
    const chunks: string[] = [];
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
      chunks.push(String(c));
      return true;
    });
    const code = await run(["--help"]);
    outSpy.mockRestore();
    expect(code).toBe(0);
    expect(chunks.join("")).toContain("saylent gate-check");
  });

  it("requires a domain", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await run([]);
    errSpy.mockRestore();
    expect(code).toBe(1);
  });
});

/** Nothing resolves: every fetch answers with the shape safeFetch returns for
 *  a host that is not there. */
const DEAD_FETCHER: Fetcher = async (url) => ({ status: 0, finalUrl: url, text: "" });

describe("the Result line names what failed", () => {
  it("turns failing checks into phrases, and counts missing schema", () => {
    expect(
      summarizeChecks([
        { check: "robots: PerplexityBot", status: "fail", detail: "blocked — costs citations" },
        { check: "JSON-LD Organization", status: "fail", detail: "No Organization schema found" },
        { check: "JSON-LD Product", status: "warn", detail: "No Product schema found" },
        { check: "JSON-LD FAQPage", status: "warn", detail: "No FAQPage schema found" },
        { check: "robots.txt", status: "pass", detail: "found" },
      ]),
    ).toEqual({
      verdict: "FAIL",
      reasons: ["PerplexityBot blocked in robots.txt", "3 schema missing"],
    });
  });

  it("names a CDN block with its status code", () => {
    expect(
      summarizeChecks([{ check: "live fetch as ClaudeBot", status: "fail", detail: "HTTP 403" }]).reasons,
    ).toEqual(["ClaudeBot blocked at the CDN (HTTP 403)"]);
  });

  it("a clean run says so instead of printing two zeroes", () => {
    expect(summarizeChecks([{ check: "robots.txt", status: "pass", detail: "found" }])).toEqual({
      verdict: "PASS",
      reasons: ["nothing blocked, no schema missing"],
    });
  });

  it("caps the named failures at three and counts the rest", () => {
    const many = ["A", "B", "C", "D", "E"].map((a) => ({
      check: `robots: ${a}`,
      status: "fail" as const,
      detail: "blocked",
    }));
    expect(summarizeChecks(many).reasons).toEqual([
      "A blocked in robots.txt",
      "B blocked in robots.txt",
      "C blocked in robots.txt",
      "+2 more",
    ]);
  });

  it("prints the failing check in the live Result line, not a zero count", async () => {
    const lines: string[] = [];
    await runGateCheckWith(engineMod, "acme.example", (l) => lines.push(l), makeFetcher({ blockClaudeBot: true }));
    expect(lines.join("")).toMatch(/Result\s+FAIL · ClaudeBot blocked at the CDN \(HTTP 403\)/);
  });
});

describe("an unreachable domain", () => {
  it("prints 'unreachable' for every probe, never a ✓, and exits 2", async () => {
    const lines: string[] = [];
    const code = await runGateCheckWith(engineMod, "nope.invalid", (l) => lines.push(l), DEAD_FETCHER);
    const out = lines.join("");
    expect(code).toBe(EXIT_UNREACHABLE);
    expect(out).not.toContain("✓");
    expect(out).toMatch(/robots\.txt\s+training: unreachable/);
    expect(out).toMatch(/live probe\s+unreachable/);
    expect(out).toMatch(/JSON-LD\s+unreachable/);
    expect(out).toMatch(/meta\s+unreachable/);
    expect(out).toMatch(/Result\s+FAIL · site unreachable/);
    expect(out).toContain("Could not fetch nope.invalid");
  });

  it("never asks for a star on an unreachable domain", async () => {
    const lines: string[] = [];
    await runGateCheckWith(engineMod, "nope.invalid", (l) => lines.push(l), DEAD_FETCHER);
    expect(lines.join("")).not.toContain("Star the repo");
  });
});

describe("--json", () => {
  it("prints the whole checks array plus the verdict, and nothing else", async () => {
    const lines: string[] = [];
    const code = await runGateCheckWith(
      engineMod,
      "acme.example",
      (l) => lines.push(l),
      makeFetcher({ blockClaudeBot: true }),
      { json: true },
    );
    const parsed = JSON.parse(lines.join("")) as {
      domain: string;
      verdict: string;
      reasons: string[];
      exit_code: number;
      reachable: boolean;
      checks: { check: string; status: string }[];
    };
    expect(code).toBe(1);
    expect(parsed.domain).toBe("acme.example");
    expect(parsed.verdict).toBe("FAIL");
    expect(parsed.exit_code).toBe(1);
    expect(parsed.reachable).toBe(true);
    expect(parsed.reasons.join(" ")).toContain("ClaudeBot");
    // the FULL array, not the curated lines
    expect(parsed.checks.some((c) => c.check === "live fetch as ClaudeBot")).toBe(true);
    expect(parsed.checks.length).toBeGreaterThan(5);
  });

  it("says unreachable in JSON too, with exit_code 2", async () => {
    const lines: string[] = [];
    const code = await runGateCheckWith(engineMod, "nope.invalid", (l) => lines.push(l), DEAD_FETCHER, {
      json: true,
    });
    const parsed = JSON.parse(lines.join("")) as { verdict: string; exit_code: number; reachable: boolean };
    expect(code).toBe(EXIT_UNREACHABLE);
    expect(parsed).toMatchObject({ verdict: "FAIL", exit_code: 2, reachable: false });
  });
});
