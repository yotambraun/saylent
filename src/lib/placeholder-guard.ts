// NEVER SPEND A RUN ON PLACEHOLDER QUESTIONS.
//
// packages/engine buildBrandModel fills two template slots with stand-ins when
// the brand carries nothing: `category` → "product" and `icp` → "teams
// evaluating options". With both blank, generateQuestions produces 23 questions
// that literally read "What is the best product for teams evaluating options?".
// a usability review created a brand with the (then optional) fields empty and was offered
// exactly that, with "Start my audit" fully enabled — about $3 of the operator's
// own provider credit spent on questions no buyer has ever typed.
//
// The form now requires both fields (src/app/app/onboarding/onboarding-form.tsx
// + actions.ts), and this is the guard behind the form: createRun refuses an
// AUDIT whose questions would still carry a stand-in, whatever route asked for
// it. Pure over its inputs so vitest pins it without a database.
//
// A VERIFY is never checked: it re-asks the frozen baseline verbatim, and a
// comparison that silently changes its questions is worse than a weak one.

/** The exact stand-ins packages/engine/src/brandModel.ts falls back to. */
export const PLACEHOLDER_CATEGORY = "product";
export const PLACEHOLDER_ICP = "teams evaluating options";

/** The phrase that can only come from the icp stand-in — it is not something a
 *  real buyer description collides with, so scanning question text for it is
 *  safe. The category stand-in is a common English word, so it is only ever
 *  detected on the FIELD, never inside question text. */
const ICP_STANDIN_RE = /teams evaluating options/i;

const blank = (v: string | null | undefined) => !String(v ?? "").trim();
const isStandIn = (v: string | null | undefined, standIn: string) =>
  String(v ?? "").trim().toLowerCase() === standIn;

export interface PlaceholderCheckInput {
  /** brands.category as stored */
  category?: string | null;
  /** brands.icp as stored */
  icp?: string | null;
  /** the question texts this run would actually ask, when they are already
   *  decided (a frozen question_set, or an edited run_options draft). Empty /
   *  omitted ⇒ the set will be generated from the fields above at run time. */
  questionTexts?: readonly string[];
}

/**
 * The user-facing refusal, or null when the run may proceed. The message is
 * rendered verbatim (same contract as every other createRun reason), so it names
 * the field and where to fix it.
 */
export function placeholderRefusal(input: PlaceholderCheckInput): string | null {
  const texts = input.questionTexts ?? [];
  if (texts.length > 0) {
    // The set is already decided: judge the text itself, not the fields.
    if (texts.some((t) => ICP_STANDIN_RE.test(t))) {
      return "These questions still say “teams evaluating options”, which is the stand-in we use when we don’t know who buys from you. Set who buys you on the brand, then re-baseline the questions — an audit of stand-in questions tells you nothing and still costs money.";
    }
    return null;
  }
  if (blank(input.category) || isStandIn(input.category, PLACEHOLDER_CATEGORY)) {
    return "We don’t know your category yet, so every question would ask about “product” instead of what you actually sell. Add your category (for example “uptime monitoring”) on the brand, then start the audit.";
  }
  if (blank(input.icp) || isStandIn(input.icp, PLACEHOLDER_ICP)) {
    return "We don’t know who buys from you yet, so the questions would ask about “teams evaluating options” instead of your buyers. Add who buys you (for example “restaurant owners”) on the brand, then start the audit.";
  }
  return null;
}

/** True when this text still carries a generation stand-in. Used by the confirm
 *  page's preview to keep the words out of the on-screen question list. */
export function containsPlaceholder(text: string): boolean {
  return ICP_STANDIN_RE.test(text);
}
