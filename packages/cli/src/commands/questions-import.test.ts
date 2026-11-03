// `saylent questions import`: routing from `saylent questions`, preview, JSON,
// writing and --force, the rewrite path with a fake model (estimate printed,
// refused without --yes off a terminal), the loader round-trip with a locale,
// and the surface-locale precedence.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { loadQuestionSetFile } from "../questions-file";
import { resolveSurfaceLocale } from "../surfaces";
import { run as questionsRun } from "./questions";
import { runQuestionsImport } from "./questions-import";

const GSC = "Top queries,Clicks,Impressions,CTR,Position\nbest uptime monitoring tool,40,1200,3.3%,4\nkestrel uptime login,9,900,1%,1\nuptime monitor for startups,12,800,1.5%,7\n";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((c: string) => (out.push(String(c)), true)) as typeof process.stdout.write;
  process.stderr.write = ((c: string) => (err.push(String(c)), true)) as typeof process.stderr.write;
  return { out, err, restore: () => ((process.stdout.write = o), (process.stderr.write = e)) };
}

const setup = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "saylent-qimport-"));
  writeFileSync(path.join(dir, "Queries.csv"), GSC);
  return dir;
};

describe("saylent questions import", () => {
  it("is routed from `saylent questions import` and previews without writing", async () => {
    const dir = setup();
    const c = capture();
    const code = await questionsRun(["import", path.join(dir, "Queries.csv"), "--exclude", "kestrel", "--preview"]);
    c.restore();
    expect(code).toBe(0);
    const text = c.out.join("");
    expect(text).toContain("Kept 2 of 3 rows: 1 matched --exclude.");
    expect(text).toContain(" 1. best uptime monitoring tool  1,200 impr.");
    expect(text).toContain("Preview only: nothing written.");
  });

  it("writes a questions.json audit --questions loads, locale included, and refuses to overwrite", async () => {
    const dir = setup();
    const out = path.join(dir, "questions.json");
    const c = capture();
    const code = await runQuestionsImport([path.join(dir, "Queries.csv"), "--out", out, "--language", "de", "--country", "DE"]);
    const again = await runQuestionsImport([path.join(dir, "Queries.csv"), "--out", out]);
    c.restore();
    expect(code).toBe(0);
    expect(again).toBe(1);
    expect(c.err.join("")).toContain("Pass --force to overwrite");
    const loaded = loadQuestionSetFile(out);
    expect(loaded.shape).toBe("questions.json");
    expect(loaded.locale).toEqual({ language: "de", country: "de" });
    expect(loaded.questions.map((q) => [q.qid, q.qtype, q.source])).toEqual([
      ["u01", "custom", "user"],
      ["u02", "custom", "user"],
      ["u03", "custom", "user"],
    ]);
  });

  it("prints JSON, and refuses a ZIP, a bad --type and an empty result", async () => {
    const dir = setup();
    const c = capture();
    expect(await runQuestionsImport([path.join(dir, "Queries.csv"), "--json", "--max", "1"])).toBe(0);
    writeFileSync(path.join(dir, "export.zip"), "PK");
    expect(await runQuestionsImport([path.join(dir, "export.zip")])).toBe(1);
    expect(await runQuestionsImport([path.join(dir, "Queries.csv"), "--type", "vibes"])).toBe(1);
    expect(await runQuestionsImport([path.join(dir, "Queries.csv"), "--include", "nothing-matches"])).toBe(1);
    c.restore();
    expect(JSON.parse(c.out[0]).questions).toHaveLength(1);
    expect(c.err.join("")).toContain("Unzip it and import the Queries.csv inside.");
  });

  it("rewrites through the model only after the estimate, and keeps the query as `from`", async () => {
    const dir = setup();
    const out = path.join(dir, "q.json");
    let prompts = 0;
    const complete = async () => (prompts++, "What is the best uptime monitoring tool?\nHow do I log in to Kestrel Uptime?\nWhich uptime monitor suits a startup?");
    const c = capture();
    const refused = await runQuestionsImport([path.join(dir, "Queries.csv"), "--rewrite", "--out", out], {
      complete,
      confirmIo: { input: new PassThrough(), output: new PassThrough(), isTTY: false },
    });
    const code = await runQuestionsImport([path.join(dir, "Queries.csv"), "--rewrite", "--yes", "--out", out], { complete });
    c.restore();
    expect(refused).toBe(1);
    expect(code).toBe(0);
    expect(prompts).toBe(1);
    expect(c.out.join("")).toMatch(/Rewrite\s+3 queries in one drafter call · est\. under \$\d+\.\d\d of your credits/);
    const doc = JSON.parse(readFileSync(out, "utf8"));
    expect(doc.questions[0]).toMatchObject({ text: "What is the best uptime monitoring tool?", from: "best uptime monitoring tool" });
  });
});

describe("surface locale precedence", () => {
  it("flags and config win; the questions file's locale fills what is left", () => {
    expect(resolveSurfaceLocale({ questions: { language: "de", country: "de" } })).toMatchObject({ country: "de", language: "de" });
    expect(resolveSurfaceLocale({ country: "fr", questions: { language: "de", country: "de" } })).toMatchObject({ country: "fr", language: "de" });
    expect(resolveSurfaceLocale({ locale: "es", config: { country: "mx" }, questions: { language: "de", country: "de" } })).toMatchObject({ country: "mx", language: "es" });
  });
});

describe("the MCP questions_import preview", () => {
  it("previews a file inside the working directory and writes nothing", async () => {
    const { questionsImportTool } = await import("../mcp/questions-import");
    const dir = setup();
    const r = questionsImportTool({ file_path: "Queries.csv", exclude: ["kestrel"], max: 5 }, dir);
    expect(r.summary).toBe("Kept 2 of 3 rows: 1 matched --exclude.");
    expect(r.cost_usd).toBe(0);
    expect(() => questionsImportTool({ file_path: "../x.csv" }, dir)).toThrow(/file_path must be inside/);
  }, 60000);
});
