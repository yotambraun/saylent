import { describe, expect, it } from "vitest";
import { parseFailOn } from "./fail-on";
import { renderSummaryMarkdown } from "./summary";
import type { GateResult } from "./types";

const FAKE_RESULT: GateResult = {
  domain: "acme.example",
  overall: "fail",
  classes: [
    { kind: "training", label: "Training", status: "warn", findings: ["GPTBot (robots.txt): blocked — a legitimate choice"] },
    { kind: "search", label: "Search-index", status: "fail", findings: ["PerplexityBot (robots.txt): blocked — citation eligibility lost"] },
    { kind: "user", label: "User-fetch", status: "pass", findings: ["ChatGPT-User (live probe): HTTP 200"] },
  ],
  other: [{ check: "JSON-LD Organization", status: "pass", detail: "present" }],
  elapsedMs: 4200,
};

describe("renderSummaryMarkdown", () => {
  it("renders a per-class markdown table with the domain and overall result", () => {
    const md = renderSummaryMarkdown(FAKE_RESULT, parseFailOn("search,user"));
    expect(md).toContain("acme.example");
    expect(md).toContain("| Bot class | Status |");
    expect(md).toContain("Training");
    expect(md).toContain("Search-index");
    expect(md).toContain("User-fetch");
    expect(md).toContain("GPTBot (robots.txt)");
    expect(md).toContain("PerplexityBot (robots.txt)");
    expect(md).toContain("FAIL ✗");
    expect(md).toContain("WARN ⚠");
    expect(md).toContain("PASS ✓");
  });

  it("marks whether each class actually gates the job, per fail_on", () => {
    const md = renderSummaryMarkdown(FAKE_RESULT, parseFailOn("search,user"));
    // training is WARN and not in fail_on scope by default — shown as not gating.
    expect(md).toMatch(/Training \| WARN ⚠ \| no \(not in `fail_on`\)/);
    // search is FAIL and IS in fail_on — shown as gating.
    expect(md).toMatch(/Search-index \| FAIL ✗ \| yes/);
  });

  it("includes the other-findings detail table and the server-logs caveat", () => {
    const md = renderSummaryMarkdown(FAKE_RESULT);
    expect(md).toContain("Other checks");
    expect(md).toContain("JSON-LD Organization");
    expect(md).toContain("server logs are ground truth");
  });

  it("never breaks the table on a finding containing a pipe character", () => {
    const withPipe: GateResult = {
      ...FAKE_RESULT,
      other: [{ check: "weird | check", status: "warn", detail: "a | b" }],
    };
    const md = renderSummaryMarkdown(withPipe);
    expect(md).toContain("weird \\| check");
    expect(md).toContain("a \\| b");
  });
});
