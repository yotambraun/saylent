// SINGLE-PROVIDER MODE: the report states, once in
// the masthead and once in the Brief's verdict area, that a run judged on one
// provider key carries a weaker self-preference guarantee. A cross-family run
// (two keys) says nothing at all — the note is not boilerplate.
// createElement instead of JSX: this suite is a .test.ts, like every other test
// in the repo (vitest include is *.test.ts).
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Brief, SINGLE_FAMILY_JUDGE_NOTE } from "../components/brief";
import { ReportMasthead } from "./document";
import { StaticReportHost } from "./static-host";
import type { ReportMeta } from "./types";

const meta = (judgeMode?: "cross-family" | "single-family"): ReportMeta => ({
  profile: "smoke",
  engines: ["chatgpt"],
  models: { chatgpt: "gpt-5.4" },
  cost: 0.42,
  ...(judgeMode ? { judgeMode } : {}),
});

const masthead = (judgeMode?: "cross-family" | "single-family") =>
  renderToString(
    createElement(ReportMasthead, {
      title: "Acme Cloud · Saylent report",
      generatedAt: "2026-09-09T10:03:00.000Z",
      meta: meta(judgeMode),
    }),
  );

const RUN = {
  id: "run_1",
  kind: "audit",
  status: "done",
  stage: "done",
  profile: "smoke",
  scores: null,
  est_cost_usd: 0.42,
  error: null,
  created_at: "2026-09-09T10:00:00.000Z",
  finished_at: "2026-09-09T10:03:00.000Z",
};

const brief = (judgeMode?: "cross-family" | "single-family") => {
  const inner = createElement(Brief, {
    run: RUN as never,
    brand: { name: "Acme Cloud", domain: "acme.example", aliases: ["Acme"], competitors: [] },
    answers: [],
    corpus: [],
    checks: [],
    fixes: [],
    demo: true,
    judgeMode,
  });
  return renderToString(
    // eslint-disable-next-line react/no-children-prop -- no JSX in a .test.ts, and the host's props type requires `children`, so it travels in the props object
    createElement(StaticReportHost, { methodologyUrl: null, children: inner }),
  );
};

describe("single-family judge note", () => {
  it("the masthead states it on a single-family run", () => {
    const html = masthead("single-family");
    expect(html).toContain("single-family");
    expect(html).toContain("Judged by a single model family (one provider key).");
    expect(html).toContain("add a second key for it.");
  });

  it("the masthead says nothing about it on a cross-family run", () => {
    const html = masthead("cross-family");
    expect(html).toContain("cross-family");
    expect(html).not.toContain("Judged by a single model family");
  });

  it("a run recorded before single-provider mode renders no Judge fact at all", () => {
    const html = masthead();
    expect(html).not.toContain("Judged by a single model family");
    expect(html).not.toContain(">Judge<");
  });

  it("the Brief carries the same one sentence, and only in single-family mode", () => {
    expect(brief("single-family")).toContain(SINGLE_FAMILY_JUDGE_NOTE);
    expect(brief("cross-family")).not.toContain(SINGLE_FAMILY_JUDGE_NOTE);
    expect(brief()).not.toContain(SINGLE_FAMILY_JUDGE_NOTE);
  });

  it("the sentence uses no em-dash", () => {
    expect(SINGLE_FAMILY_JUDGE_NOTE).not.toContain("—");
  });
});
