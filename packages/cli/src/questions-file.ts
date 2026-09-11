// `--questions <file>` and the file `saylent questions` writes.
//
// THREE shapes are accepted, all through loadQuestionSetFile():
//
//  a. a previous run's run.json (a full RunBundleV1) — reuse its frozen set
//     verbatim, exactly as before;
//  b. the questions.json this module WRITES (`{brand, version, questions:
//     [{id, type, text}]}`), edited or extended by hand. Rows without an `id`
//     get one; rows without a `type` are typed "custom";
//  c. a plain text file, one question per line. `#` starts a comment, blank
//     lines are skipped, and a line may be tagged with a type
//     ("category: What is the best CDN for startups?"). Untagged lines are
//     typed "custom".
//
// THE BAND RULE (the honest part): only `category` and `problem` questions are
// SCORED (engine score.ts SCORED), so only questions you tag with one of those
// types can move the recommended band. Everything else — including every
// "custom" question — is asked, judged and reported, and deliberately excluded
// from the band, so adding your own questions can never inflate your own score.
//
// Anything the user wrote is marked `source: "user"` so the run bundle records
// whose question it was, and so a smoke run asks the operator's own questions
// instead of silently dropping them (engine selectForProfile).
import { readFileSync } from "node:fs";

/** The shipped question types (engine types.ts QType). "custom" is what an
 *  untagged user question gets. */
export const QUESTION_TYPES = [
  "category",
  "comparison",
  "problem",
  "branded",
  "integration",
  "migration",
  "trust",
  "custom",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** The types that count toward the score and the recommended band. */
export const SCORED_TYPES: readonly QuestionType[] = ["category", "problem"];

export interface LoadedQuestion {
  qid: string;
  text: string;
  qtype: string;
  source?: "template" | "user";
  /** Samples feature: a per-question sample count (1-5) that wins over the
   *  run-level --samples/AUDIT_SAMPLES/config default for THIS question. */
  samples?: number;
}

export interface QuestionSetFile {
  questions: LoadedQuestion[];
  /** the brand's question-set envelope version (run bundles only) */
  version?: number;
  engines?: string[];
  /** the template-set version a questions.json was generated from ("2", "2+custom") */
  templateVersion?: number | string;
  /** which of the three shapes this file was */
  shape: "bundle" | "questions.json" | "text";
}

/** The editable file `saylent questions` writes and `--questions` reads back. */
export interface QuestionsJson {
  brand: string;
  domain?: string;
  version: number | string;
  questions: {
    id: string;
    type: string;
    text: string;
    source?: "template" | "user";
    samples?: number;
  }[];
}

const isType = (value: unknown): value is QuestionType =>
  typeof value === "string" && (QUESTION_TYPES as readonly string[]).includes(value);

/** q01, q02, … — the next free id after everything already claimed. */
function idAssigner(taken: Set<string>): () => string {
  let n = 0;
  return () => {
    let id: string;
    do {
      n += 1;
      id = `q${String(n).padStart(2, "0")}`;
    } while (taken.has(id));
    taken.add(id);
    return id;
  };
}

/** Serialize a question set into the editable questions.json shape. */
export function toQuestionsJson(
  brand: string,
  domain: string,
  version: number | string,
  questions: {
    qid: string;
    text: string;
    qtype: string;
    source?: "template" | "user";
    samples?: number;
  }[],
): QuestionsJson {
  return {
    brand,
    domain,
    version,
    questions: questions.map((q) => ({
      id: q.qid,
      type: q.qtype,
      text: q.text,
      source: q.source ?? "template",
      ...(q.samples !== undefined ? { samples: q.samples } : {}),
    })),
  };
}

/** One question per line, `#` comments, optional "<type>: " tag. */
export function parseQuestionsText(text: string): LoadedQuestion[] {
  const taken = new Set<string>();
  const nextId = idAssigner(taken);
  const out: LoadedQuestion[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    let qtype = "custom";
    let body = line;
    const at = line.indexOf(":");
    if (at > 0) {
      const tag = line.slice(0, at).trim().toLowerCase();
      if (isType(tag)) {
        qtype = tag;
        body = line.slice(at + 1).trim();
      }
    }
    if (!body) continue;
    out.push({ qid: nextId(), text: body, qtype, source: "user" });
  }
  return out;
}

function fromQuestionRows(rows: unknown[], file: string): LoadedQuestion[] {
  const taken = new Set<string>();
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const id = typeof r?.id === "string" ? r.id : typeof r?.qid === "string" ? r.qid : "";
    if (id) taken.add(id);
  }
  const nextId = idAssigner(taken);
  const out: LoadedQuestion[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text.trim() : "";
    if (!text) throw new Error(`--questions ${file}: every question needs a non-empty "text".`);
    const rawType = typeof r.type === "string" ? r.type : typeof r.qtype === "string" ? r.qtype : "";
    const qtype = isType(rawType) ? rawType : "custom";
    const id = typeof r.id === "string" && r.id ? r.id : typeof r.qid === "string" && r.qid ? r.qid : nextId();
    const source: "template" | "user" =
      r.source === "template" || r.source === "user" ? r.source : "user";
    let samples: number | undefined;
    if (r.samples !== undefined) {
      if (typeof r.samples !== "number" || !Number.isInteger(r.samples) || r.samples < 1 || r.samples > 5) {
        throw new Error(`--questions ${file}: "${id}" samples must be a whole number 1-5 (got ${JSON.stringify(r.samples)}).`);
      }
      samples = r.samples;
    }
    out.push({ qid: id, text, qtype, source, ...(samples !== undefined ? { samples } : {}) });
  }
  if (out.length === 0) throw new Error(`--questions ${file}: the file has no questions.`);
  return out;
}

export function loadQuestionSetFile(file: string): QuestionSetFile {
  const text = readFileSync(file, "utf8");
  const looksJson = /^\s*[[{]/.test(text);

  // (c) plain text: one question per line
  if (!looksJson) {
    const questions = parseQuestionsText(text);
    if (questions.length === 0) {
      throw new Error(`--questions ${file}: no questions found (one question per line, # for comments).`);
    }
    return { questions, shape: "text" };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`--questions ${file}: not readable JSON (${e instanceof Error ? e.message : String(e)})`);
  }

  if (Array.isArray(raw)) {
    return { questions: fromQuestionRows(raw, file), shape: "questions.json" };
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    // (a) a full run bundle: reuse its frozen questions + envelope, untouched
    if (obj.version === 1 && Array.isArray(obj.questions) && obj.run && typeof obj.run === "object") {
      const run = obj.run as Record<string, unknown>;
      return {
        questions: obj.questions as LoadedQuestion[],
        version: typeof run.question_set_version === "number" ? run.question_set_version : undefined,
        engines: Array.isArray(run.engines) ? (run.engines as string[]) : undefined,
        templateVersion:
          typeof run.template_set_version === "number" || typeof run.template_set_version === "string"
            ? (run.template_set_version as number | string)
            : undefined,
        shape: "bundle",
      };
    }
    // (b) the questions.json shape (`brand` + rows keyed id/type), or the older
    //     bare {"questions": [...]} with qid/qtype rows.
    if (Array.isArray(obj.questions)) {
      const rows = obj.questions as unknown[];
      const isQuestionsJson =
        typeof obj.brand === "string" ||
        rows.some((r) => Boolean(r) && typeof r === "object" && ("id" in (r as object) || "type" in (r as object)));
      return {
        questions: fromQuestionRows(rows, file),
        version: !isQuestionsJson && typeof obj.version === "number" ? obj.version : undefined,
        engines: Array.isArray(obj.engines) ? (obj.engines as string[]) : undefined,
        templateVersion:
          isQuestionsJson && (typeof obj.version === "number" || typeof obj.version === "string")
            ? (obj.version as number | string)
            : undefined,
        shape: "questions.json",
      };
    }
  }
  throw new Error(
    `--questions ${file}: expected a run.json bundle, a questions.json ({"questions":[{"id","type","text"}]}), or one question per line.`,
  );
}

/** How many of a set the band can move: only scored types count. */
export function scoredCount(questions: { qtype: string }[]): number {
  return questions.filter((q) => (SCORED_TYPES as readonly string[]).includes(q.qtype)).length;
}
