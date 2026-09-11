// "Confirm your audit" (template-set v2) — the PURE,
// client-safe preview shim. It builds a minimal BrandModel from the confirm
// page's editable fields and runs the SAME deterministic generateQuestions the
// pipeline freezes (src/inngest/functions.ts "questions" step), so what the buyer
// sees is exactly what the audit will ask — no LLM, no crawl, no engine imports.
//
// Faithfulness to the pipeline (src/engine/brandModel.ts buildBrandModel):
//  - category: a set value wins verbatim; blank → "product" (buildBrandModel's fallback).
//  - icp: a set value wins verbatim; blank → "teams evaluating options" (its derived
//    fallback). Left blank, the AUDIT refines icp from the crawled site — the preview
//    shows this generic stand-in and the page says so honestly.
//  - competitors / problems: passed through as-is. With no competitors,
//    generateQuestions no longer fills comparison/migration with "the leading
//    alternative" / "another leading option" filler — it skips those templates
//    and reports it via the returned array's `.skipped` (no-competitor) field, which
//    this preview passes straight through so the page can say so honestly.
// generateQuestions imports ONLY type-only from src/engine/types (pure), so this
// module is safe to import into both the server page and the client component.
import { generateQuestions, type GeneratedQuestions } from "@saylent/engine/questions";
import type { BrandModel } from "@saylent/engine/types";

export interface PreviewFields {
  brand: string;
  category: string;
  icp: string;
  competitors: string[];
  problems?: string[];
}

/** Build the minimal BrandModel generateQuestions consumes. Only the template
 *  slots (brand/category/icp/competitors/problems) carry meaning; the rest are
 *  guaranteed-shape placeholders. Mirrors buildBrandModel's category/icp fallbacks
 *  so the on-screen preview matches the frozen set generated from the same fields. */
export function buildPreviewModel(fields: PreviewFields): BrandModel {
  const competitors = fields.competitors.map((c) => c.trim()).filter(Boolean);
  const problems = (fields.problems ?? []).map((p) => p.trim()).filter(Boolean);
  return {
    brand: fields.brand,
    domain: "",
    aliases: [fields.brand],
    category: fields.category.trim() || "product",
    icp: fields.icp.trim() || "teams evaluating options",
    products: [],
    value_props: [],
    problems,
    competitors,
    language: "en",
  };
}

/** The exact question set (template-set v2, up to 23) the audit will freeze for
 *  these fields, in generation order (q01…qNN). Deterministic given (fields,
 *  year). Carries `.skipped` when comparison/migration templates were left out
 *  for lack of a named rival — see generateQuestions in packages/engine. */
export function buildPreviewQuestions(fields: PreviewFields, year: number): GeneratedQuestions {
  return generateQuestions(buildPreviewModel(fields), year);
}
