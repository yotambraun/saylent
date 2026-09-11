// The spec (see METHODOLOGY.md) — scores over category+problem questions ONLY:
// per engine {answered, recommended, mentioned, rec_rate, mention_rate (null
// when answered=0)}; overall = sums; share_of_voice = other_brands counts
// (top 12, trimmed). Verify additions: before/after + per-published-fix
// watch notes computed against the baseline answers.
import type { AnswerRow, Engine, Fix, QType, Scores, Verdict } from "./types";
import { normOtherBrands } from "./verdict-compat";

const ENGINES: Engine[] = ["chatgpt", "claude", "gemini", "perplexity"];
/** the spec (see METHODOLOGY.md) — the ONLY qtypes that count toward scores (and the ONLY qtypes
 *  adaptively sampled — see profiles.sampleCount / needsTiebreak). Exported so
 *  profiles/observe share one source of truth for "is this a scored question". */
export const SCORED: ReadonlyArray<QType> = ["category", "problem"];
export function isScored(qtype: string): boolean {
  return (SCORED as ReadonlyArray<string>).includes(qtype);
}

// ---- adaptive sampling: majority vote + confidence band (migration 0033) ----

type Usage = { input_tokens?: number; output_tokens?: number; searches?: number };
type MentionType = Verdict["mention_type"];
/** One sampled draw behind a canonical answer (AnswerRow + its 0-based draw index). */
export type Draw = AnswerRow & { sampleIdx: number };

// Strength ordering for the "all three draws differ" tie-break. The task fixes
// recommended > listed = compared > neutral > absent; `dismissed` (a NEGATIVE
// mention) is placed as the weakest non-absent tier (below neutral). listed and
// compared share a tier — the enum-index secondary key keeps the pick deterministic.
const MENTION_STRENGTH: Record<MentionType, number> = {
  recommended: 0,
  listed: 1,
  compared: 1,
  neutral: 2,
  dismissed: 3,
  absent: 4,
};
const MENTION_ORDER: MentionType[] = [
  "recommended",
  "listed",
  "compared",
  "neutral",
  "dismissed",
  "absent",
];

/** Majority vote over the draws' mention_type. With 3 draws the count partitions
 *  are {3}, {2,1} (mode wins) or {1,1,1} (all differ). On any tie ("all differ"
 *  is the only 3-draw case), sort the tied values by (strength, enum-index) and
 *  take the middle — floor(n/2), which rounds an even tie toward the WEAKER
 *  (conservative: never over-claims "recommended"). Returns null for no draws. */
export function voteMentionType(mentions: MentionType[]): MentionType | null {
  if (mentions.length === 0) return null;
  const freq = new Map<MentionType, number>();
  for (const m of mentions) freq.set(m, (freq.get(m) ?? 0) + 1);
  const maxCount = Math.max(...freq.values());
  const modes = [...freq.entries()].filter(([, c]) => c === maxCount).map(([m]) => m);
  if (modes.length === 1) return modes[0];
  const sorted = modes.slice().sort(
    (a, b) =>
      MENTION_STRENGTH[a] - MENTION_STRENGTH[b] ||
      MENTION_ORDER.indexOf(a) - MENTION_ORDER.indexOf(b),
  );
  return sorted[Math.floor(sorted.length / 2)];
}

function sumUsage(draws: Draw[]): Usage | undefined {
  let input = 0;
  let output = 0;
  let searches = 0;
  let any = false;
  for (const d of draws) {
    if (!d.usage) continue;
    any = true;
    input += d.usage.input_tokens ?? 0;
    output += d.usage.output_tokens ?? 0;
    searches += d.usage.searches ?? 0;
  }
  return any ? { input_tokens: input, output_tokens: output, searches } : undefined;
}

export interface VoteResult {
  /** the ONE canonical answers row for this (qid, engine) */
  canonical: AnswerRow;
  /** sampleIdx of the representative draw (null when every draw failed) */
  representativeIdx: number | null;
}

/** Fold N sampled draws for one (qid, engine) into the canonical answers row
 *  (migration 0033): majority-voted mention_type; the REPRESENTATIVE draw = the
 *  first ok draw whose mention_type equals the vote (its raw_text/citations/
 *  verdict become canonical, with mention_type pinned to the vote); usage SUMMED
 *  across every draw (ok or failed) for cost truth. Works for ANY draw count:
 *  1 draw (non-scored) → that draw is canonical; 2 agreeing draws (adaptive
 *  sampling, no tiebreak needed) → mode of two identical mentions IS the vote,
 *  representative = draw 0; 3 draws (a tiebroken group) → the majority-of-3.
 *  All draws failed → canonical is the failed draw 0, unjudged (matches today's
 *  failed-answer shape). Pure. */
export function voteAnswer(draws: Draw[]): VoteResult {
  const base = draws[0];
  const usage = sumUsage(draws);
  const okDraws = draws.filter((d) => d.ok && d.verdict);
  if (okDraws.length === 0) {
    const canonical: AnswerRow = {
      qid: base.qid,
      qtype: base.qtype,
      question: base.question,
      engine: base.engine,
      ok: false,
      raw_text: base.raw_text,
      citations: base.citations,
      ...(base.error ? { error: base.error } : {}),
      ...(usage ? { usage } : {}),
    };
    return { canonical, representativeIdx: null };
  }
  const voted = voteMentionType(okDraws.map((d) => d.verdict!.mention_type))!;
  const rep = okDraws.find((d) => d.verdict!.mention_type === voted) ?? okDraws[0];
  const canonical: AnswerRow = {
    qid: base.qid,
    qtype: base.qtype,
    question: base.question,
    engine: base.engine,
    ok: true,
    raw_text: rep.raw_text,
    citations: rep.citations,
    // voted fields guaranteed: pin mention_type to the vote (rep already matches).
    verdict: { ...(rep.verdict as Verdict), mention_type: voted },
    ...(usage ? { usage } : {}),
  };
  return { canonical, representativeIdx: rep.sampleIdx };
}

/** Adaptive-sampling tiebreak decision. Mathematical basis: under
 *  majority-of-3, two AGREEING ok draws are already the majority regardless of a
 *  third draw, so a third is informative ONLY when the initial draws do NOT decide
 *  the vote — i.e. they DISAGREE, or one/both FAILED (a failed draw has no verdict,
 *  so a fresh draw can still swing voteAnswer's outcome). Returns true ⇒ take ONE
 *  more full-depth draw so the canonical verdict is VOTE-IDENTICAL to always asking
 *  3×, at ~⅓ fewer scored draws. Pure predicate over the (typically two) initial
 *  draws; the CALLER decides WHICH groups it runs on (scored, tiebreak-on profile). */
export function needsTiebreak(draws: Draw[]): boolean {
  const ok = draws.filter((d) => d.ok && d.verdict);
  // any failed/unjudged draw, or fewer than two usable opinions → not yet decided
  if (ok.length < draws.length || ok.length < 2) return true;
  const first = ok[0].verdict!.mention_type;
  return ok.some((d) => d.verdict!.mention_type !== first); // disagreement → tiebreak
}

export interface Band {
  min: number;
  max: number;
}
export interface RecommendedBand {
  overall: Band;
  per_engine: Record<Engine, Band>;
}
/** One scored draw's mention_type by (qid, engine, sampleIdx) — the input the
 *  confidence band reads to reconstruct each sample-set. */
export interface SampleMention {
  qid: string;
  engine: Engine;
  sampleIdx: number;
  mention_type: MentionType | null;
}

/** Confidence band (task 2): sample-set s = every scored (engine, question)'s
 *  s-th draw where present, else the canonical answer. recommended_band = the
 *  {min, max} recommended-count across the sample-sets, per engine and overall.
 *  No samples (smoke / old runs) ⇒ one set ⇒ min == max (point estimate).
 *  ADAPTIVE SAMPLING mixes 2- and 3-draw groups: nSets = the max draw count seen
 *  (2 if no group was tiebroken, else 3). An AGREEING pair has no s=2 draw, so
 *  the missing→canonical fallback fills set 2 with its (agreed) canonical mention
 *  → that group contributes a tight/degenerate range; only a TIEBROKEN triple
 *  spans all three sets. Honest either way. Pure. */
export function recommendedBand(
  scoredCanonical: { qid: string; engine: Engine; mention_type: MentionType | null }[],
  samples: SampleMention[],
): RecommendedBand {
  const nSets = samples.length ? Math.max(...samples.map((s) => s.sampleIdx)) + 1 : 1;
  const key = (qid: string, engine: Engine, s: number) => `${qid}|${engine}|${s}`;
  const sampleMap = new Map<string, MentionType | null>();
  for (const s of samples) sampleMap.set(key(s.qid, s.engine, s.sampleIdx), s.mention_type);

  const perEngine = {} as Record<Engine, number[]>;
  for (const e of ENGINES) perEngine[e] = new Array(nSets).fill(0);
  const overall = new Array(nSets).fill(0);

  for (let s = 0; s < nSets; s++) {
    for (const c of scoredCanonical) {
      const k = key(c.qid, c.engine, s);
      const mention = sampleMap.has(k) ? sampleMap.get(k)! : c.mention_type;
      if (mention === "recommended") {
        perEngine[c.engine][s] += 1;
        overall[s] += 1;
      }
    }
  }
  const band = (counts: number[]): Band => ({ min: Math.min(...counts), max: Math.max(...counts) });
  const per_engine = {} as Record<Engine, Band>;
  for (const e of ENGINES) per_engine[e] = band(perEngine[e]);
  return { overall: band(overall), per_engine };
}

/** Scores plus the additive confidence band (stored in the scores jsonb; old
 *  runs lack recommended_band). computeScores returns this; it is assignable to
 *  Scores everywhere the band is not needed. */
export interface ScoresWithBand extends Scores {
  recommended_band?: RecommendedBand;
}

/** "Apollo.io" → "apollo" · "Clearbit (Breeze Intelligence)" → "clearbit" */
export function canonicalBrand(name: string): string {
  return name
    .trim()
    .replace(/\s*\(.*\)\s*$/, "")
    .replace(/\.(io|ai|com|app|dev|co)$/i, "")
    .trim()
    .toLowerCase();
}

export function computeScores(answers: AnswerRow[], samples: SampleMention[] = []): ScoresWithBand {
  const scored = answers.filter((a) => isScored(a.qtype));
  const per = {} as Scores["per_engine"];
  for (const engine of ENGINES) {
    const rows = scored.filter((a) => a.engine === engine);
    const answered = rows.filter((a) => a.ok).length;
    const recommended = rows.filter((a) => a.verdict?.mention_type === "recommended").length;
    const mentioned = rows.filter((a) => a.verdict?.brand_present).length;
    per[engine] = {
      answered,
      recommended,
      mentioned,
      rec_rate: answered === 0 ? null : recommended / answered,
      mention_rate: answered === 0 ? null : mentioned / answered,
    };
  }
  const sum = (k: "answered" | "recommended" | "mentioned") =>
    ENGINES.reduce((s, e) => s + per[e][k], 0);
  const answered = sum("answered");
  const overall = {
    answered,
    recommended: sum("recommended"),
    mentioned: sum("mentioned"),
    rec_rate: answered === 0 ? null : sum("recommended") / answered,
    mention_rate: answered === 0 ? null : sum("mentioned") / answered,
  };

  // Canonicalize rival names so "Apollo" + "Apollo.io" + "Clearbit (Breeze
  // Intelligence)" don't split one company's voice across rows (observed on a real run).
  const sov = new Map<string, { display: string; count: number }>();
  for (const a of answers) {
    // normOtherBrands handles BOTH shapes (old string[], new {name,why}[]); we
    // count on .name only — the `why` data is for the UI to read from verdicts.
    for (const { name } of normOtherBrands(a.verdict)) {
      const raw = name.trim();
      if (!raw) continue;
      const key = canonicalBrand(raw);
      const entry = sov.get(key) ?? { display: raw, count: 0 };
      entry.count += 1;
      // prefer the shortest raw form as the display name (Apollo < Apollo.io)
      if (raw.length < entry.display.length) entry.display = raw;
      sov.set(key, entry);
    }
  }
  // Merge word-suffix variants: "sales navigator" ⊂ "linkedin sales navigator"
  // (observed on a real run). Counts fold into the longer, more specific name.
  for (const shortKey of [...sov.keys()]) {
    const longKey = [...sov.keys()].find((k) => k !== shortKey && k.endsWith(` ${shortKey}`));
    if (longKey) {
      const shortEntry = sov.get(shortKey);
      const longEntry = sov.get(longKey);
      if (shortEntry && longEntry) {
        longEntry.count += shortEntry.count;
        sov.delete(shortKey);
      }
    }
  }
  const share_of_voice = Object.fromEntries(
    [...sov.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
      .map((e) => [e.display, e.count]),
  );

  // Additive confidence band over the (adaptive 2- or 3-) sample-sets (task 2).
  // scored canonical rows carry the voted mention_type; missing draws fall back
  // to canonical (an agreeing pair contributes a tight band, a tiebroken triple
  // the full range).
  const recommended_band = recommendedBand(
    scored.map((a) => ({
      qid: a.qid,
      engine: a.engine,
      mention_type: a.verdict?.mention_type ?? null,
    })),
    samples,
  );

  return { per_engine: per, overall, share_of_voice, recommended_band };
}

/** qids where the brand is present now but wasn't at baseline (per engine-agnostic union) */
function presentQids(answers: AnswerRow[]): Set<string> {
  return new Set(answers.filter((a) => a.verdict?.brand_present).map((a) => a.qid));
}

export interface WatchNote {
  fixKey: string;
  title: string;
  newlyPresentQids: string[];
  note: string;
}

/** the spec (see METHODOLOGY.md) verify — per published fix: count evidence qids where the brand
 *  is now present that weren't at baseline. Honest "no movement yet" otherwise. */
export function watchNotes(
  publishedFixes: Fix[],
  baselineAnswers: AnswerRow[],
  currentAnswers: AnswerRow[],
): WatchNote[] {
  const before = presentQids(baselineAnswers);
  const after = presentQids(currentAnswers);
  return publishedFixes.map((fix) => {
    const evidenceQids = [
      ...new Set(fix.evidence.flatMap((e) => [...e.matchAll(/\[(q\d{2})\]/g)].map((m) => m[1]))),
    ];
    const newly = evidenceQids.filter((qid) => after.has(qid) && !before.has(qid));
    const engines = currentAnswers
      .filter((a) => newly.includes(a.qid) && a.verdict?.brand_present)
      .map((a) => a.engine);
    return {
      fixKey: fix.fixKey,
      title: fix.title,
      newlyPresentQids: newly,
      note:
        newly.length > 0
          ? `+${newly.length} question${newly.length > 1 ? "s" : ""} now name you (${[...new Set(engines)].join(", ")})`
          : `no movement yet — within the stated ${fix.timeToImpact}`,
    };
  });
}
