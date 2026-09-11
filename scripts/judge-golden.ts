// Operator/dev use: golden-set harness. Measures the CURRENT production judge
// against the human reference labels in fixtures/golden-judge.json (v2, public).
//
// Self-contained: the fixture inlines the brand model and the RAW ANSWER TEXT of
// every answer in fixtures/golden-judge-source.json, so this needs LLM keys and nothing
// else — no database, no run ids, no network beyond the judge calls. It runs the
// SAME path functions.ts uses — judgeAnswers() + judgeCall (models from
// src/lib/models.ts, never hard-coded) — and compares per field against the
// reference.
//
// 18 judgeable answers => ~18 cheap cross-family judge calls per pass (≈ $0.20).
// Nothing is written anywhere (a no-op DbWriter swallows the verdicts).
// Prod-refuses.
//
// Usage:
//   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scripts/judge-golden.ts
//   --field <name>        compare only that field (mention_type | prominence | sentiment | other_brands)
//   --limit  <N>          judge only the first N labels (cheap iteration)
//   --min-agreement <f>   exit 1 if any scored field agrees on less than fraction f
//                         (e.g. 0.8). Default: report only, always exit 0.
//   --offline             $0, no keys: replay the verdicts the production judge
//                         produced for these same answers in the source run
//                         (judge_at_labeling) instead of calling the judge. Use
//                         it to check the fixture, never as a judge-change gate.
import { readFileSync } from "node:fs";
import { judgeAnswers } from "@saylent/engine/judge";
import { judgeCall } from "@saylent/engine/llm";
import type { AnswerRow, BrandModel, DbWriter, Engine, QType, Verdict } from "@saylent/engine/types";

const FIELDS = ["mention_type", "prominence", "sentiment", "other_brands"] as const;
type Field = (typeof FIELDS)[number];

export interface GoldenRef {
  mention_type: string;
  prominence: string;
  sentiment: string;
  entity_confusion?: boolean;
  /** RECALL check: every name here must appear in the judge's other_brands
   *  (case-insensitive substring). [] means the answer names no brand at all
   *  and the judge must return none. Absent = the label is not scored on it. */
  other_brands?: string[];
}
export interface GoldenLabel {
  qid: string;
  engine: string;
  qtype: string;
  question: string;
  /** raw answer text, byte-identical to fixtures/golden-judge-source.json ("" when the
   *  engine call failed in the source run) */
  answer: string;
  /** false ⇒ the engine call failed; there is nothing to judge. Absent ⇒ judgeable. */
  judgeable?: boolean;
  engine_error?: string;
  ref?: GoldenRef;
  reasoning?: string;
  ambiguous?: boolean;
  judge_at_labeling?: string;
  judge_other_brands_at_labeling?: string[];
  agree?: boolean;
}
export interface GoldenFixture {
  _meta: Record<string, unknown>;
  brand_model: BrandModel;
  labels: GoldenLabel[];
}

export const GOLDEN_PATH = "fixtures/golden-judge.json";

export function loadGolden(path = GOLDEN_PATH): GoldenFixture {
  return JSON.parse(readFileSync(path, "utf8")) as GoldenFixture;
}

/** The labels the harness scores: an engine answer exists and carries a ref. */
export function judgeableLabels(fx: GoldenFixture): GoldenLabel[] {
  return fx.labels.filter((l) => l.judgeable !== false && l.ref);
}

/** other_brands agreement = recall of the reference names in the judge's list;
 *  an empty reference list demands an empty judge list. */
export function otherBrandsAgree(want: string[], got: string[]): boolean {
  if (want.length === 0) return got.length === 0;
  return want.every((w) => got.some((g) => g.toLowerCase().includes(w.toLowerCase())));
}

// judgeAnswers only calls setStage + saveVerdict; a no-op stub keeps the harness
// read-only while exercising the exact production judge path.
const noopDb = {
  setStage: async () => {},
  saveVerdict: async () => {},
} as unknown as DbWriter;

function argVal(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i !== -1) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : undefined;
}

/** --offline: rebuild the stored baseline verdict from the fixture itself. */
function replayVerdict(l: GoldenLabel): Verdict {
  const [mention_type, prominence, sentiment] = (l.judge_at_labeling ?? "//").split("/");
  return {
    brand_present: mention_type !== "absent",
    mention_type,
    prominence,
    sentiment,
    claims: [],
    other_brands: (l.judge_other_brands_at_labeling ?? []).map((name) => ({ name, why: "" })),
    excerpt: "",
  } as unknown as Verdict;
}

async function main() {
  if (process.env.VERCEL_ENV === "production") throw new Error("judge-golden forbidden in prod");

  const args = process.argv.slice(2);
  const offline = args.includes("--offline");
  const fieldArg = argVal(args, "--field") as Field | undefined;
  if (fieldArg && !FIELDS.includes(fieldArg)) throw new Error(`--field must be one of ${FIELDS.join("|")}`);
  const fields: readonly Field[] = fieldArg ? [fieldArg] : FIELDS;
  const limit = Number(argVal(args, "--limit") ?? "0") || 0;
  const minArg = argVal(args, "--min-agreement");
  const min = minArg === undefined ? null : Number(minArg);
  if (min !== null && !(min >= 0 && min <= 1)) throw new Error("--min-agreement takes a fraction 0..1");

  if (!offline && (!process.env.ANTHROPIC_API_KEY || !process.env.OPENAI_API_KEY)) {
    throw new Error("judge-golden needs ANTHROPIC_API_KEY + OPENAI_API_KEY (cross-family judge), or --offline");
  }

  const fx = loadGolden();
  let labels = judgeableLabels(fx);
  const skipped = fx.labels.length - labels.length;
  if (limit > 0) labels = labels.slice(0, limit);

  const answers: AnswerRow[] = labels.map((l) => ({
    qid: l.qid,
    qtype: l.qtype as QType,
    question: l.question,
    engine: l.engine as Engine,
    ok: true,
    raw_text: l.answer,
    citations: [],
  }));

  process.stdout.write(
    `${offline ? "replaying stored verdicts for" : "judging"} ${answers.length} answers ` +
      `(${skipped} of ${fx.labels.length} skipped: the engine call failed in the source run)…\n`,
  );
  const judged = offline
    ? answers.map((a, i) => ({ ...a, verdict: replayVerdict(labels[i]) }))
    : await judgeAnswers(answers, fx.brand_model, noopDb, "golden", judgeCall, 6);

  const agree = { mention_type: 0, prominence: 0, sentiment: 0, other_brands: 0 };
  const total = { mention_type: 0, prominence: 0, sentiment: 0, other_brands: 0 };
  const disagreements: Record<Field, string[]> = {
    mention_type: [],
    prominence: [],
    sentiment: [],
    other_brands: [],
  };
  let noVerdict = 0;

  for (const l of labels) {
    const ref = l.ref;
    if (!ref) continue;
    const v = judged.find((a) => a.qid === l.qid && a.engine === l.engine)?.verdict;
    if (!v) {
      noVerdict++;
      continue;
    }
    const flag = l.ambiguous ? " [ambiguous]" : "";
    for (const f of fields) {
      if (f === "other_brands") {
        if (!ref.other_brands) continue;
        total.other_brands++;
        const got = (v.other_brands ?? []).map((o) => (typeof o === "string" ? o : o.name));
        if (otherBrandsAgree(ref.other_brands, got)) agree.other_brands++;
        else {
          disagreements.other_brands.push(
            `  ${l.qid}/${l.engine}${flag}  got=[${got.join(", ")}]  ref=[${ref.other_brands.join(", ")}]\n     ${l.reasoning ?? ""}`,
          );
        }
        continue;
      }
      total[f]++;
      const got = String((v as unknown as Record<string, unknown>)[f]);
      const want = String(ref[f]);
      if (got === want) agree[f]++;
      else {
        disagreements[f].push(
          `  ${l.qid}/${l.engine}${flag}  got=${got}  ref=${want}\n     ${l.reasoning ?? ""}`,
        );
      }
    }
  }

  const n = labels.length;
  console.log(`\n=== per-field agreement (n=${n}${noVerdict ? `, ${noVerdict} unjudged` : ""}) ===`);
  for (const f of fields) console.log(`${f.padEnd(13)} ${agree[f]}/${total[f]}`);
  for (const f of fields) {
    if (!disagreements[f].length) continue;
    console.log(`\n--- ${f} disagreements (${disagreements[f].length}) ---`);
    for (const line of disagreements[f]) console.log(line);
  }
  console.log(`\nSUMMARY n=${n} ${fields.map((f) => `${f}=${agree[f]}/${total[f]}`).join(" ")}`);
  if (offline) {
    console.log("(--offline replays the verdicts stored in the fixture; it is NOT a live judge pass.)");
  }

  if (min !== null) {
    const below = fields.filter((f) => total[f] > 0 && agree[f] / total[f] < min);
    if (below.length) {
      console.error(
        `\nFAIL --min-agreement ${min}: ${below
          .map((f) => `${f}=${(agree[f] / total[f]).toFixed(2)}`)
          .join(" ")}`,
      );
      process.exit(1);
    }
    console.log(`PASS --min-agreement ${min}`);
  }
}

// tsx runs this file directly; the exports above exist for the unit test.
if (process.argv[1]?.endsWith("judge-golden.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
