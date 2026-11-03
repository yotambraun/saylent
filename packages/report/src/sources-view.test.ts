// The report's bridge to the engine's source intelligence, the Markdown
// section built from it, and how a surface's "not shown" answers are counted.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fixtureToReportData } from "./render/fixture";
import { renderMarkdown } from "./render/markdown";
import { receiptLabel, sourcesFor, sourcesLede } from "./sources-view";
import { failuresLine, runTotals, totalsLine } from "./totals";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const fx = JSON.parse(readFileSync(path.join(repoRoot, "fixtures/run.json"), "utf8"));
const data = fixtureToReportData(fx);

describe("sourcesFor on the fixture run", () => {
  const intel = sourcesFor({ brand: data.brand, answers: data.answers, corpus: data.corpus });

  it("states counts only in the lede", () => {
    const lede = sourcesLede(intel)!;
    expect(lede).toMatch(/^\d+ citations to \d+ domains across \d+ of the \d+ answers\./);
    expect(lede).not.toMatch(/score/i);
  });

  it("every opportunity receipt opens an answer the report has", () => {
    const keys = new Set(data.answers.map((a) => `${a.qid}|${a.engine}`));
    expect(intel.opportunities.length).toBeGreaterThan(0);
    for (const o of intel.opportunities) for (const r of o.receipts) expect(keys.has(`${r.qid}|${r.engine}`)).toBe(true);
  });

  it("labels receipts with the engine's display name", () => {
    expect(receiptLabel({ qid: "q01", engine: "google_ai_overview" })).toBe("q01 · Google AI Overviews");
  });

  it("honours a domain-type override carried on the report data", () => {
    const top = intel.opportunities[0].host;
    const md = renderMarkdown({ ...data, sourceOverrides: { domainTypes: { [top]: "rival_site" } } });
    const section = md.slice(md.indexOf("## Sources & opportunities"), md.indexOf("## Cited pages"));
    expect(section).not.toContain(`**${top}**`);
  });
});

describe("the Markdown section", () => {
  const md = renderMarkdown(data);
  it("sits between the answers and the cited pages", () => {
    const at = md.indexOf("## Sources & opportunities");
    expect(at).toBeGreaterThan(md.indexOf("## The answers"));
    expect(at).toBeLessThan(md.indexOf("## Cited pages"));
    for (const h of ["### Off-site opportunities", "### Citation share by domain", "### Who the answers name, by engine"]) {
      expect(md).toContain(h);
    }
  });
});

describe("not-shown surface answers", () => {
  const rows = [
    { ok: true, qtype: "category" },
    { ok: false, qtype: "category", error: "no_answer: Google AI Overviews showed no answer for this question (x)" },
    { ok: false, qtype: "category", error: "server: 503" },
  ];
  it("are counted apart from engine failures", () => {
    const t = runTotals(rows);
    expect(t).toMatchObject({ asked: 3, answered: 1, failed: 1, notShown: 1 });
    expect(totalsLine(t)).toBe("3 asked · 1 answered · 1 not shown · 1 engine failure · 1 scored");
    const line = failuresLine(t)!;
    expect(line).toContain("1 of the 3 calls returned no answer");
    expect(line).toContain("never as an absence");
  });
  it("leave a run without surfaces byte-identical", () => {
    const t = runTotals([{ ok: true }, { ok: false }]);
    expect(t).toEqual({ asked: 2, answered: 1, failed: 1, scored: 0 });
  });
});
