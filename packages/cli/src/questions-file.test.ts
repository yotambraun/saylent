import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadQuestionSetFile, toQuestionsJson } from "./questions-file";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), "saylent-qf-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("loadQuestionSetFile", () => {
  it("loads a bare array of questions", () => {
    const dir = tempDir();
    const file = path.join(dir, "q.json");
    writeFileSync(file, JSON.stringify([{ qid: "q01", text: "best CDN", qtype: "category" }]));
    const parsed = loadQuestionSetFile(file);
    expect(parsed.questions).toEqual([{ qid: "q01", text: "best CDN", qtype: "category", source: "user" }]);
    expect(parsed.version).toBeUndefined();
  });

  it("loads a {questions, version, engines} wrapper", () => {
    const dir = tempDir();
    const file = path.join(dir, "q.json");
    writeFileSync(
      file,
      JSON.stringify({ questions: [{ qid: "q01", text: "x", qtype: "category" }], version: 3, engines: ["chatgpt"] }),
    );
    const parsed = loadQuestionSetFile(file);
    expect(parsed.version).toBe(3);
    expect(parsed.engines).toEqual(["chatgpt"]);
  });

  it("loads a full run.json bundle, reusing its frozen questions + envelope", () => {
    const dir = tempDir();
    const file = path.join(dir, "run.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        run: { question_set_version: 5, engines: ["chatgpt", "claude"] },
        questions: [{ qid: "q01", text: "x", qtype: "category" }],
      }),
    );
    const parsed = loadQuestionSetFile(file);
    expect(parsed.version).toBe(5);
    expect(parsed.engines).toEqual(["chatgpt", "claude"]);
    expect(parsed.questions).toHaveLength(1);
  });

  it("throws a clear error on unreadable JSON", () => {
    const dir = tempDir();
    const file = path.join(dir, "bad.json");
    writeFileSync(file, "{ not json");
    expect(() => loadQuestionSetFile(file)).toThrow(/not readable JSON/);
  });

  it("throws a clear error on a shape that is neither a bundle nor {questions}", () => {
    const dir = tempDir();
    const file = path.join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ foo: "bar" }));
    expect(() => loadQuestionSetFile(file)).toThrow(/expected a run\.json bundle/);
  });

  // Samples feature: a questions.json row can carry its own sample count,
  // which wins over the run-level --samples/AUDIT_SAMPLES/config default.
  describe("per-question samples override", () => {
    it("reads a row's samples field through", () => {
      const dir = tempDir();
      const file = path.join(dir, "q.json");
      writeFileSync(
        file,
        JSON.stringify({
          brand: "Acme",
          domain: "acme.example",
          version: 2,
          questions: [{ id: "q01", type: "category", text: "best CDN", samples: 3 }],
        }),
      );
      const parsed = loadQuestionSetFile(file);
      expect(parsed.questions[0].samples).toBe(3);
    });

    it("leaves samples undefined when the row doesn't carry one", () => {
      const dir = tempDir();
      const file = path.join(dir, "q.json");
      writeFileSync(file, JSON.stringify([{ qid: "q01", text: "x", qtype: "category" }]));
      const parsed = loadQuestionSetFile(file);
      expect(parsed.questions[0].samples).toBeUndefined();
    });

    it("rejects an out-of-range or non-integer samples value with a clear error naming the row", () => {
      const dir = tempDir();
      const badHigh = path.join(dir, "high.json");
      writeFileSync(badHigh, JSON.stringify([{ qid: "q01", text: "x", qtype: "category", samples: 9 }]));
      expect(() => loadQuestionSetFile(badHigh)).toThrow(/"q01" samples must be a whole number 1-5/);

      const badFraction = path.join(dir, "fraction.json");
      writeFileSync(badFraction, JSON.stringify([{ qid: "q02", text: "x", qtype: "category", samples: 2.5 }]));
      expect(() => loadQuestionSetFile(badFraction)).toThrow(/samples must be a whole number 1-5/);
    });
  });

  describe("toQuestionsJson", () => {
    it("writes a row's samples field only when present", () => {
      const json = toQuestionsJson("Acme", "acme.example", 2, [
        { qid: "q01", text: "x", qtype: "category", samples: 3 },
        { qid: "q02", text: "y", qtype: "branded" },
      ]);
      expect(json.questions[0]).toMatchObject({ id: "q01", samples: 3 });
      expect(json.questions[1]).not.toHaveProperty("samples");
    });
  });
});
