// buildMovement — the pure composer behind the verify view. Two runs of the SAME
// frozen questions in, one deterministic movement model out. No LLM, no DB.
//
// The rule the product lives by: nothing is compared that was not frozen. A run
// whose question set differs from its baseline cannot claim movement, and this
// composer says so in `comparable` instead of quietly diffing a different set.
import { diffAnswer, type DiffSentence } from "./answer-diff";

export interface MovementAnswer {
  qid: string;
  engine: string;
  question: string;
  raw_text: string;
  verdict: { brand_present?: boolean; mention_type?: string } | null;
}

export interface MovementFix {
  fix_key: string;
  published_at: string | null;
}

export interface EngineScore {
  answered: number;
  recommended: number;
  mentioned: number;
}

export interface MovementScores {
  per_engine?: Record<string, EngineScore>;
  overall?: EngineScore;
  verify?: {
    baseline: { per_engine?: Record<string, EngineScore>; overall?: EngineScore } | null;
    watch_notes: { fixKey: string; title: string; note: string; newlyPresentQids: string[] }[];
  };
}

export interface MovementSide {
  runId: string;
  finishedAt: string | null;
  scores: MovementScores | null;
  answers: MovementAnswer[];
  fixes?: MovementFix[];
}

export interface MovementChange {
  qid: string;
  question: string;
  before: string;
  after: string;
  entered: DiffSentence[];
  departed: DiffSentence[];
}

export interface MovementEngineRow {
  engine: string;
  flagged: boolean;
  beforeRecommended: number;
  afterRecommended: number;
  beforeMentioned: number;
  afterMentioned: number;
  changes: MovementChange[];
}

export interface MovementWatchNote {
  fixKey: string;
  title: string;
  note: string;
  moved: boolean;
  /** en-GB shipped date of the baseline fix, when it was marked shipped */
  shippedAt: string | null;
}

export interface Movement {
  brand: { name: string; domain: string };
  baselineRunId: string;
  runId: string;
  finishedAt: string | null;
  /** false when the two runs did not answer the same question set */
  comparable: boolean;
  /** questions in the frozen set (per engine), for the "x/N" hero */
  questionCount: number;
  before: number;
  after: number;
  /** |after - before| <= 1 is inside normal variation; the view says so */
  withinNoise: boolean;
  engines: string[];
  rows: MovementEngineRow[];
  watchNotes: MovementWatchNote[];
  /** the single rationed celebration line, or null */
  celebration: { fixKey: string; line: string } | null;
}

export const MOVEMENT_ENGINES = ["chatgpt", "claude", "gemini", "perplexity"];

const ENGINE_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
};

const mentionOf = (a: MovementAnswer) => a.verdict?.mention_type ?? null;
const presentOf = (a: MovementAnswer) => a.verdict?.brand_present === true;

/** engine -> qid -> mention_type */
function mentionIndex(answers: MovementAnswer[]): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const a of answers) {
    const mt = mentionOf(a);
    if (!mt) continue;
    let byQid = out.get(a.engine);
    if (!byQid) out.set(a.engine, (byQid = new Map()));
    byQid.set(a.qid, mt);
  }
  return out;
}

export function buildMovement(input: {
  brand: { name: string; domain: string; aliases?: string[] };
  baseline: MovementSide;
  current: MovementSide;
}): Movement {
  const { brand, baseline, current } = input;
  const aliases = brand.aliases?.length ? brand.aliases : [brand.name];

  const scores = current.scores ?? {};
  // A verify run carries its own baseline aggregates; a standalone pair of audits
  // does not, so fall back to the baseline run's own scores.
  const base = scores.verify?.baseline ?? baseline.scores ?? {};
  const before = base.overall?.recommended ?? 0;
  const after = scores.overall?.recommended ?? 0;
  const engineCount = Math.max(
    1,
    MOVEMENT_ENGINES.filter((e) => (scores.per_engine?.[e]?.answered ?? 0) > 0).length,
  );
  const questionCount = Math.round((scores.overall?.answered ?? 0) / engineCount) || 0;

  const currentQids = new Set(current.answers.map((a) => a.qid));
  const baselineQids = new Set(baseline.answers.map((a) => a.qid));
  const comparable =
    currentQids.size > 0 &&
    baselineQids.size > 0 &&
    currentQids.size === baselineQids.size &&
    [...currentQids].every((q) => baselineQids.has(q));

  const nowIdx = mentionIndex(current.answers);
  const wasIdx = mentionIndex(baseline.answers);
  const rawOf = (rows: MovementAnswer[]) => {
    const m = new Map<string, string>();
    for (const a of rows) m.set(`${a.engine}:${a.qid}`, a.raw_text ?? "");
    return m;
  };
  const currentRaw = rawOf(current.answers);
  const baselineRaw = rawOf(baseline.answers);
  const questionOf = new Map<string, string>();
  for (const a of current.answers) questionOf.set(`${a.engine}:${a.qid}`, a.question);

  const rows: MovementEngineRow[] = MOVEMENT_ENGINES.map((e) => {
    const now = nowIdx.get(e);
    const was = wasIdx.get(e);
    const changes: MovementChange[] = [];
    if (now && was && comparable) {
      for (const [qid, afterMt] of now) {
        const beforeMt = was.get(qid);
        if (!beforeMt || beforeMt === afterMt) continue;
        const question = questionOf.get(`${e}:${qid}`) ?? qid;
        const d = diffAnswer(
          { qid, engine: e, question, raw_text: baselineRaw.get(`${e}:${qid}`) ?? "" },
          { qid, engine: e, question, raw_text: currentRaw.get(`${e}:${qid}`) ?? "" },
          aliases,
        );
        changes.push({
          qid,
          question,
          before: beforeMt,
          after: afterMt,
          entered: d.added,
          departed: d.removed,
        });
      }
    }
    const b = base.per_engine?.[e];
    const c = scores.per_engine?.[e];
    return {
      engine: e,
      flagged: (c?.answered ?? 0) === 0,
      beforeRecommended: b?.recommended ?? 0,
      afterRecommended: c?.recommended ?? 0,
      beforeMentioned: b?.mentioned ?? 0,
      afterMentioned: c?.mentioned ?? 0,
      changes: changes.sort((a, z) => a.qid.localeCompare(z.qid)),
    };
  });

  const shippedAt = new Map<string, string>();
  for (const f of baseline.fixes ?? []) if (f.published_at) shippedAt.set(f.fix_key, f.published_at);

  const notes = scores.verify?.watch_notes ?? [];
  const watchNotes: MovementWatchNote[] = notes.map((w) => ({
    fixKey: w.fixKey,
    title: w.title,
    note: w.note,
    moved: w.newlyPresentQids.length > 0,
    shippedAt: shippedAt.get(w.fixKey) ?? null,
  }));

  // THE ONE CELEBRATION — the first shipped fix whose watched qids now name the
  // brand where they did not at baseline. Attributed to one engine only when
  // exactly one engine newly names you across those qids.
  const movedNote = notes.find((w) => w.newlyPresentQids.length > 0) ?? null;
  let celebration: Movement["celebration"] = null;
  if (movedNote) {
    const presentNow = new Map<string, Set<string>>();
    for (const a of current.answers) {
      if (!presentOf(a)) continue;
      const set = presentNow.get(a.qid) ?? new Set<string>();
      set.add(a.engine);
      presentNow.set(a.qid, set);
    }
    const engines = new Set<string>();
    for (const qid of movedNote.newlyPresentQids) {
      for (const e of presentNow.get(qid) ?? []) engines.add(e);
    }
    const only = engines.size === 1 ? [...engines][0] : null;
    celebration = {
      fixKey: movedNote.fixKey,
      line: only
        ? `That fix worked. ${ENGINE_LABEL[only] ?? only} now cites you.`
        : "That fix worked. The answers moved.",
    };
  }

  return {
    brand: { name: brand.name, domain: brand.domain },
    baselineRunId: baseline.runId,
    runId: current.runId,
    finishedAt: current.finishedAt,
    comparable,
    questionCount,
    before,
    after,
    withinNoise: Math.abs(after - before) <= 1,
    engines: MOVEMENT_ENGINES,
    rows,
    watchNotes,
    celebration,
  };
}
