// The verify view's per-engine table names every engine and answer surface by
// its registry label ("Google AI Overviews"), never the raw id.
// createElement instead of JSX: this suite is a .test.ts, like every other test.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PerEngineTable, type EngineRow } from "../components/per-engine-table";
import { StaticReportHost } from "./static-host";

const row = (engine: string, changes = 0): EngineRow => ({
  engine,
  flagged: false,
  beforeRecommended: 1,
  afterRecommended: 2,
  beforeMentioned: 2,
  afterMentioned: 3,
  changes: Array.from({ length: changes }, (_, i) => ({
    qid: `q0${i + 1}`,
    question: "best uptime monitor",
    before: "absent",
    after: "recommended",
  })),
});

describe("PerEngineTable", () => {
  it("prints registry labels for engines and surfaces", () => {
    const inner = createElement(PerEngineTable, {
      engines: ["chatgpt", "google_ai_overview", "copilot"],
      rows: [row("chatgpt", 1), row("google_ai_overview"), row("copilot", 2)],
      baselineRunId: "run-base",
    });
    const html = renderToString(
      // eslint-disable-next-line react/no-children-prop -- no JSX in a .test.ts, and the host's props type requires `children`, so it travels in the props object
      createElement(StaticReportHost, { methodologyUrl: null, children: inner }),
    );
    expect(html).toContain("ChatGPT");
    expect(html).toContain("Google AI Overviews");
    expect(html).toContain("Microsoft Copilot");
    expect(html).not.toMatch(/>google_ai_overview</);
    expect(html).not.toMatch(/>copilot</);
  });
});
