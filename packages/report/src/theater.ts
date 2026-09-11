// Audit Theater derivations — pure, SSR-safe, NO React/Supabase imports.
// Turns a live run's frozen questions + the answers streamed in by the poll
// into: the BOARD (questions × the four engines as a grid of slots), the
// SPOTLIGHT (the newest answer), and honest COUNTERS. Every value is derived
// ONLY from data actually present — a slot is never "present" without a verdict,
// a counter never claims answers that have not landed. run-view.tsx feeds it
// lean rows (raw_text pre-sliced, verdict->brand_present extracted); the derive
// is memoised there. Unit-pinned in theater.test.ts.
//
// @saylent/engine is a real workspace package (node_modules symlink +
// source-level `exports`) — both value and type imports through it resolve
// at test runtime (open-source split, 2026-09-09; see source-map.ts). This
// one is `import type` and erases regardless.
import type { Engine } from "@saylent/engine/types";
import { parseStage } from "./run-stages";
import { ENGINE_LABEL, hostOf } from "./source-map";

/** The four engines, in canonical column order (matches observe.ts ENGINES). */
export const THEATER_ENGINES: readonly Engine[] = ["chatgpt", "claude", "gemini", "perplexity"];

export const engineLabel = (e: string): string =>
  ENGINE_LABEL[e] ?? e.charAt(0).toUpperCase() + e.slice(1);

/** Short unambiguous column stub for the board header (full name stays in
 *  `title=`). "Ch/Cl" (a 2-char slice) read as noise — these don't. */
const ENGINE_STUB: Record<string, string> = {
  chatgpt: "GPT",
  claude: "Cla",
  gemini: "Gem",
  perplexity: "Pplx",
};
export const engineStub = (e: string): string => ENGINE_STUB[e] ?? engineLabel(e).slice(0, 3);

/** The raw qtype ("category"/"branded"/…) in the buyer's own words — the same
 *  names the confirm screen and funnel use, so the spotlight reads consistently. */
const QTYPE_LABEL: Record<string, string> = {
  category: "What-to-buy",
  comparison: "Head-to-head",
  problem: "Problem-led",
  branded: "Brand questions",
  integration: "Works-with",
  migration: "Switching",
  trust: "Trust",
};
export const qtypeLabel = (t: string): string => QTYPE_LABEL[t] ?? t;

/** A question in the brand's frozen set (brands.question_set.questions[]). */
export interface TheaterQuestion {
  qid: string;
  qtype: string;
  text: string;
}

/** One answer as the run view polls it. Lean by construction: `excerpt` is
 * raw_text pre-sliced client-side, and `brand_present` is the extracted
 * verdict->brand_present boolean (null until the answer is judged). */
export interface TheaterAnswer {
  qid: string;
  engine: string;
  ok: boolean;
  question: string;
  qtype?: string;
  /** raw_text sliced to a short excerpt before it reaches here */
  excerpt: string;
  citations: { url?: string | null; title?: string | null }[];
  /** verdict->brand_present; null when the answer is not yet judged */
  brand_present: boolean | null;
  created_at: string;
}

export type SlotState = "empty" | "answered" | "present" | "absent" | "flagged";
export interface Slot {
  engine: Engine;
  state: SlotState;
}
export interface BoardRow {
  qid: string;
  qtype: string;
  question: string;
  slots: Slot[];
}
export interface Spotlight {
  qid: string;
  engine: Engine;
  engineLabel: string;
  qtype: string;
  question: string;
  excerpt: string;
  hosts: string[];
  /** null until judged, then the verdict's presence finding */
  brand_present: boolean | null;
}
export type TheaterPhase = "prep" | "observe" | "judge" | "corpus" | "checks" | "done";
export interface Counters {
  /** answers that have landed (ok or flagged — each is an engine that replied) */
  answersIn: number;
  /** questions asked × 4 engines; 0 only before we can know it (deep prep) */
  expectedTotal: number;
  /** answers that carry a verdict */
  verdictsIn: number;
  /** brand appears in this many judged answers; null until judging has begun */
  mentions: number | null;
}
export interface TheaterState {
  /** false ⇒ render the classic stage-only checklist (question_set absent) */
  active: boolean;
  phase: TheaterPhase;
  board: BoardRow[];
  spotlight: Spotlight | null;
  counters: Counters;
}

export interface TheaterInput {
  questions: TheaterQuestion[] | null | undefined;
  answers: TheaterAnswer[];
  stage: string | null | undefined;
  status: string;
  /** run.profile — deterministically fixes how many questions get asked */
  profile?: string | null;
}

/** Map the live stage string onto a coarse theater phase. "Reading the answers"
 * (the judge stage) is off the STAGES list, so we match its label directly. */
function phaseOf(stage: string | null | undefined, status: string): TheaterPhase {
  if (status === "done") return "done";
  const { label } = parseStage(stage);
  if (label.startsWith("Asking")) return "observe";
  if (label === "Reading the answers") return "judge";
  if (label === "Reading the pages the engines cited") return "corpus";
  if (label === "Testing your site's gates" || label === "Writing your fix plan") return "checks";
  return "prep"; // Crawling / Building your brand model / queued / off-list
}

/** How many questions this run asks. The observe stage detail ("3/6 answered")
 * is the ground truth once observing; before that we fall back to the profile
 * constant (smoke 6 / full 20), then to the distinct qids already seen. Never
 * clamped to question_set length — smoke asks a subset of the frozen set. */
function expectedQuestionCount(
  answers: TheaterAnswer[],
  stage: string | null | undefined,
  profile: string | null | undefined,
): number {
  const m = /(\d+)\s*\/\s*(\d+)\s+answered/.exec(parseStage(stage).detail);
  const fromStage = m ? Number(m[2]) : 0;
  const distinct = new Set(answers.map((a) => a.qid)).size;
  const fromProfile = profile === "smoke" ? 6 : profile === "full" ? 20 : 0;
  return Math.max(fromStage, distinct, fromProfile);
}

function slotState(a: TheaterAnswer | undefined): SlotState {
  if (!a) return "empty";
  if (!a.ok) return "flagged";
  if (a.brand_present === true) return "present";
  if (a.brand_present === false) return "absent";
  return "answered"; // landed, not yet judged
}

/** Newest answer worth spotlighting: latest by created_at that actually returned
 * text. Stable through the judge phase (no new rows arrive; verdicts update in
 * place), so the card can gain its present/absent tone without swapping cards. */
function pickSpotlight(answers: TheaterAnswer[]): Spotlight | null {
  let best: TheaterAnswer | null = null;
  for (const a of answers) {
    if (!a.ok || !a.excerpt) continue;
    if (!best || a.created_at > best.created_at) best = a;
  }
  if (!best) return null;
  const hosts: string[] = [];
  for (const c of best.citations ?? []) {
    const h = hostOf(c?.url);
    if (h && !hosts.includes(h)) hosts.push(h);
    if (hosts.length >= 6) break;
  }
  return {
    qid: best.qid,
    engine: best.engine as Engine,
    engineLabel: engineLabel(best.engine),
    qtype: best.qtype ?? "",
    question: best.question,
    excerpt: best.excerpt,
    hosts,
    brand_present: best.brand_present,
  };
}

/** Derive the whole theater from the frozen questions + streamed answers.
 * Pure: same inputs → same output, no clocks, no I/O. */
export function deriveTheater(input: TheaterInput): TheaterState {
  const { questions, answers, stage, status, profile } = input;
  const phase = phaseOf(stage, status);

  const answersIn = answers.length;
  const verdictsIn = answers.reduce((n, a) => n + (a.brand_present !== null ? 1 : 0), 0);
  const mentions = verdictsIn > 0 ? answers.reduce((n, a) => n + (a.brand_present === true ? 1 : 0), 0) : null;
  const counters: Counters = {
    answersIn,
    verdictsIn,
    mentions,
    expectedTotal: expectedQuestionCount(answers, stage, profile) * THEATER_ENGINES.length,
  };

  // No frozen question set → the theater has no board to build; the run view
  // falls back to its classic stage checklist.
  if (!questions || questions.length === 0) {
    return { active: false, phase, board: [], spotlight: null, counters };
  }

  // Index answers by qid+engine for O(1) slot lookup.
  const byKey = new Map<string, TheaterAnswer>();
  const qidsWithAnswers = new Set<string>();
  for (const a of answers) {
    byKey.set(`${a.qid} ${a.engine}`, a);
    qidsWithAnswers.add(a.qid);
  }

  // Board rows follow the FROZEN question order, but only surface a row once it
  // has at least one answer — so a smoke run (subset of the set) never shows
  // empty rows for questions it will not ask. Honest by construction.
  const board: BoardRow[] = [];
  for (const q of questions) {
    if (!qidsWithAnswers.has(q.qid)) continue;
    board.push({
      qid: q.qid,
      qtype: q.qtype,
      question: q.text,
      slots: THEATER_ENGINES.map((engine) => ({
        engine,
        state: slotState(byKey.get(`${q.qid} ${engine}`)),
      })),
    });
  }

  return { active: true, phase, board, spotlight: pickSpotlight(answers), counters };
}
