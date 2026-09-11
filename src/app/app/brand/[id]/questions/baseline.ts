// T3 — the set a brand would ask if nobody had edited anything. Its own module
// (not actions.ts) because a "use server" file may only export async functions,
// and both the page and the server action need this exact computation: the page
// to render "Reset to generated", the action to decide whether a saved draft
// really differs from the generated set. Recomputing it on the server is what
// stops a tampered client from claiming its edits match and skipping the
// re-baseline.
//
// Pure: buildPreviewQuestions is the same deterministic, LLM-free generator the
// confirm page previews with and the pipeline freezes (engine questions.ts).
import type { Question } from "@saylent/engine/types";
import { type DraftQuestion, toDraftQuestions } from "@/lib/question-options";
import { buildPreviewQuestions } from "../confirm/preview";

export interface BaselineBrand {
  name: string;
  category: string | null;
  icp: string | null;
  competitors: string[] | null;
  problems: string[] | null;
  question_set: { questions?: Question[] } | null;
}

/** The frozen set when the brand has one (a re-audit reuses it verbatim),
 *  otherwise the deterministic preview of what a first audit would generate. */
export function baselineDraft(brand: BaselineBrand, year: number): DraftQuestion[] {
  const frozen = brand.question_set?.questions;
  if (frozen?.length) return toDraftQuestions(frozen);
  return toDraftQuestions(
    buildPreviewQuestions(
      {
        brand: brand.name,
        category: brand.category ?? "",
        icp: brand.icp ?? "",
        competitors: brand.competitors ?? [],
        problems: brand.problems ?? [],
      },
      year,
    ),
  );
}
