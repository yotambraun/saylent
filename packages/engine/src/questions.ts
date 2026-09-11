// The spec (see METHODOLOGY.md) — EXACTLY the the spec (see METHODOLOGY.md) template library, quotas
// (8/5/4/3 + 1/1/1 = 23), rotation (competitor/competitor2/problem by iteration
// index), dedupe on lowercase-alphanumeric-collapsed text, cap at quota×4
// iterations per type. qids q01…q23 in generation order. The caller freezes the
// result onto the brand; verify runs pass the stored array through untouched.
import type { QuestionTemplateConfig } from "./config";
import type { BrandModel, QType, Question } from "./types";

// the spec (see METHODOLOGY.md) template-set version. v1 = the original 20-question library
// (category/comparison/problem/branded). v2 adds
// the three buyer-risk archetypes integration/migration/trust → 23 questions.
// FROZEN-SET IMMUNITY: existing brands keep their stored question_set verbatim
// (inngest/functions.ts reuses question_set.questions untouched); only new or
// re-baselined brands generate with the current template set. Bump on any change
// to TEMPLATES/QUOTAS so a stamped set records which library produced it.
export const TEMPLATE_SET_VERSION = 2;

/** The shipped types, in generation order. A questionTemplates key outside this
 *  list adds a NEW group whose questions are typed "custom" — asked and judged,
 *  never scored (score.ts SCORED stays category+problem). */
const BASE_TEMPLATES: Record<string, string[]> = {
  category: [
    "What is the best {category} for {icp}?",
    "Top {category} options in {year} — which do you recommend?",
    "Which {category} should {icp} choose and why?",
    "Affordable {category} alternatives to {competitor}",
    "Most reliable {category} for {icp}",
    "Best {category} for a small team on a budget",
    "Which {category} do experts recommend for {icp} in {year}?",
    "I need a {category} that is easy to set up — what do you suggest?",
  ],
  comparison: [
    "{brand} vs {competitor} — which is better for {icp}?",
    "{competitor} vs {competitor2}: which would you pick for {icp}?",
    "Best {competitor} alternatives",
    "Is {competitor} or {competitor2} better for {icp}?",
    "{brand} vs {competitor2}: honest comparison for {icp}",
  ],
  problem: [
    "How do I solve: {problem}? Which tools or providers help?",
    "What's the best way to handle {problem} — any recommended solutions?",
    "Recommended providers for {problem}?",
    "{problem} — which product would you use and why?",
  ],
  branded: [
    "What is {brand}? Is it any good?",
    "Is {brand} a good choice for {icp}? What are its strengths and weaknesses?",
    "{brand} pricing, reviews, and alternatives",
  ],
  // Buyer-risk archetypes (template-set v2) — the questions real buyers
  // ask before committing; engines surface risk claims + rival steers exactly here.
  integration: ["Does {brand} integrate well with the tools {icp} already use?"],
  migration: ["We're using {competitor} — is switching to {brand} worth it?"],
  trust: ["Is {brand} legit and safe to rely on for {icp}?"],
};

const BASE_QUOTAS: Record<string, number> = {
  category: 8,
  comparison: 5,
  problem: 4,
  branded: 3,
  integration: 1,
  migration: 1,
  trust: 1,
};
const BASE_ORDER: string[] = [
  "category",
  "comparison",
  "problem",
  "branded",
  "integration",
  "migration",
  "trust",
];

/** Every qtype the shipped library produces. A key outside it is "custom". */
const SHIPPED_TYPES = new Set<string>(BASE_ORDER);

/** The resolved library one run generates from: phrasings + quota per key, in
 *  generation order, plus the version stamp that set is worth. */
export interface ResolvedTemplates {
  order: string[];
  templates: Record<string, string[]>;
  quotas: Record<string, number>;
  /** true when a saylent.config questionTemplates key changed the shipped set */
  customized: boolean;
}

/**
 * Merge a saylent.config `questionTemplates` map onto the shipped library.
 *
 * MERGE SEMANTICS (config.ts questionTemplates):
 *  - a key that exists in the shipped library REPLACES its phrasings when the
 *    override carries `templates`, and/or overrides its `quota`;
 *  - a key that does NOT exist is APPENDED after the shipped keys, and its
 *    questions are typed "custom" (never scored);
 *  - `quota: 0` drops a group entirely;
 *  - an override with neither field leaves the shipped key untouched.
 * No config ⇒ the shipped library, byte for byte.
 */
export function resolveTemplates(overrides?: QuestionTemplateConfig): ResolvedTemplates {
  const templates: Record<string, string[]> = { ...BASE_TEMPLATES };
  const quotas: Record<string, number> = { ...BASE_QUOTAS };
  const order = [...BASE_ORDER];
  let customized = false;
  for (const [key, override] of Object.entries(overrides ?? {})) {
    if (!override) continue;
    const isNew = !(key in templates);
    if (isNew && !override.templates?.length) {
      throw new Error(`saylent config: questionTemplates.${key} is a new group and needs at least one template string`);
    }
    if (override.templates?.length) {
      templates[key] = [...override.templates];
      customized = true;
    }
    if (override.quota !== undefined) {
      quotas[key] = override.quota;
      customized = true;
    }
    if (isNew) {
      quotas[key] = override.quota ?? override.templates!.length;
      order.push(key);
    }
  }
  return { order: order.filter((k) => (quotas[k] ?? 0) > 0), templates, quotas, customized };
}

/** The version stamped on a generated set. Plain `2` for the shipped library;
 *  "2+custom" as soon as a config override changes it, so verify can refuse to
 *  claim movement across two different template sets. */
export function templateSetVersion(overrides?: QuestionTemplateConfig): number | string {
  return resolveTemplates(overrides).customized ? `${TEMPLATE_SET_VERSION}+custom` : TEMPLATE_SET_VERSION;
}

/** true when two stamped template-set versions are the same library. */
export function sameTemplateSet(a: number | string | null | undefined, b: number | string | null | undefined): boolean {
  return String(a ?? "") === String(b ?? "");
}

const collapse = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Sentinels brandModel.ts (buildBrandModel) falls back to when the crawled
// site names no competitor at all. Mirrored here (not imported — engine/
// brandModel.ts is a separate module and this string is the public contract
// between the two, exercised by questions.test.ts) so generateQuestions can
// tell "the site truly has no named rival" apart from "the brand model found
// exactly one real rival" (the latter still fills the comparison quota using
// the existing {competitor2} → "another leading option" rotation below).
const NO_COMPETITOR_SENTINEL = "the leading alternative";

/** A template that needs a named rival to make sense — either {competitor}
 *  or {competitor2}. Matches both without a second pattern. */
const NEEDS_COMPETITOR = /\{competitor2?\}/;

/** true once bm.competitors carries at least one competitor that ISN'T the
 *  brand-model's own no-competitor sentinel. False for both an empty array
 *  (verify-path / hand-built BrandModel literals) and the buildBrandModel
 *  guaranteed-non-empty fallback `["the leading alternative"]` — the two
 *  shapes "no competitors" actually takes by the time it reaches here. */
function hasRealCompetitor(competitors: string[]): boolean {
  return competitors.some((c) => c.trim() && c !== NO_COMPETITOR_SENTINEL);
}

/** Reported on generateQuestions' result when templates were left out of
 *  rotation for lack of a named rival — additive so existing callers that
 *  only ever read the array itself (map/length/JSON.stringify, which ignores
 *  non-index array properties) see no change. */
export interface QuestionsSkipped {
  reason: "no-competitor";
  /** number of distinct template phrasings across the resolved library that
   *  need {competitor}/{competitor2} and were left unrendered. */
  count: number;
}

export type GeneratedQuestions = Question[] & { skipped?: QuestionsSkipped };

// the spec (see METHODOLOGY.md) phrasings assume {problem} is a clean lowercase noun phrase, but
// brand-model values can arrive as capitalized sentence fragments ("Need to
// track…") or end in a period. normalizeProblem makes the value grammatical at
// the exact spot the template injects it: always trim + collapse whitespace +
// strip a trailing period, then lowercase the first letter mid-sentence
// (acronym-safe — leave "API"/"CRM" alone: only lowercase when the second char
// is itself lowercase) or uppercase it when the value opens the sentence.
function normalizeProblem(value: string, atSentenceStart: boolean): string {
  const cleaned = value.replace(/\s+/g, " ").trim().replace(/\.+$/, "");
  if (cleaned.length === 0) return cleaned;
  const first = cleaned[0];
  const second = cleaned[1];
  if (atSentenceStart) return first.toUpperCase() + cleaned.slice(1);
  const secondIsLower = !!second && second === second.toLowerCase() && second !== second.toUpperCase();
  return secondIsLower ? first.toLowerCase() + cleaned.slice(1) : cleaned;
}

export function generateQuestions(
  bm: BrandModel,
  year: number,
  /** saylent.config questionTemplates (config.ts). Absent ⇒ the shipped library. */
  overrides?: QuestionTemplateConfig,
): GeneratedQuestions {
  const lib = resolveTemplates(overrides);
  const questions: Question[] = [];
  const seen = new Set<string>();
  const competitors = bm.competitors.length > 0 ? bm.competitors : [NO_COMPETITOR_SENTINEL];
  const problems = bm.problems.length > 0 ? bm.problems : [`choosing the right ${bm.category}`];
  const n = competitors.length;
  const realCompetitor = hasRealCompetitor(competitors);
  let skippedTemplateCount = 0;

  for (const key of lib.order) {
    const qtype = (SHIPPED_TYPES.has(key) ? key : "custom") as QType;
    const allTemplates = lib.templates[key];
    // No real rival on record ⇒ don't render a template that names one (the
    // freeze q10-style "the leading alternative vs another leading option"
    // fillers four engines answered with "which two options are you
    // comparing?"). A template that doesn't need {competitor}/{competitor2}
    // still renders normally.
    const templates = realCompetitor ? allTemplates : allTemplates.filter((t) => !NEEDS_COMPETITOR.test(t));
    skippedTemplateCount += allTemplates.length - templates.length;
    if (templates.length === 0) continue; // whole group needs a rival (comparison/migration) — skip it
    const quota = lib.quotas[key];
    let count = 0;
    for (let i = 0; i < quota * 4 && count < quota; i++) {
      const competitor = competitors[i % n];
      const competitor2 = n > 1 ? competitors[(i + 1) % n] : "another leading option";
      const template = templates[i % templates.length];
      // {problem} capitalization depends on whether the template opens with it
      const problem = normalizeProblem(
        problems[i % problems.length],
        template.trimStart().startsWith("{problem}"),
      );
      const text = template
        .replaceAll("{brand}", bm.brand)
        .replaceAll("{category}", bm.category)
        .replaceAll("{icp}", bm.icp)
        .replaceAll("{competitor}", competitor)
        .replaceAll("{competitor2}", competitor2)
        .replaceAll("{problem}", problem)
        .replaceAll("{year}", String(year));
      const dedupeKey = collapse(text);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      count++;
      questions.push({
        qid: `q${String(questions.length + 1).padStart(2, "0")}`,
        text,
        qtype,
      });
    }
  }
  const result = questions as GeneratedQuestions;
  if (skippedTemplateCount > 0) {
    result.skipped = { reason: "no-competitor", count: skippedTemplateCount };
  }
  return result;
}
