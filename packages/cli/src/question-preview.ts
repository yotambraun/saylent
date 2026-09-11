// Generating the buyer questions WITHOUT running an audit — shared by
// `saylent questions <domain>` and `saylent audit --dry-run`.
//
// Two modes, and the caller must say which one it printed:
//   real      crawl the site (free) + ONE brand-model call (about $0.02 of the
//             operator's credits) so the questions carry the real category,
//             ICP, problems and rivals. This is what an audit would ask.
//   templates `--no-brand-model`: no crawl, no model call, no keys, $0. The
//             questions come from the template library with the domain name
//             and generic defaults, so they are shaped right but not specific.
import type { BrandModel } from "@saylent/engine";
import type { GeneratedQuestions } from "@saylent/engine/questions";
import type { QuestionTemplateConfig } from "@saylent/engine/config";
import type { EngineModule } from "./engine-loader";
import { glyph } from "./glyphs";

export type PreviewEngine = Pick<
  EngineModule,
  "crawlSite" | "generateQuestions" | "templateSetVersion" | "buildBrandModel" | "brandModelCall" | "safeFetch"
>;

/** The template-default brand model: everything the generator can know about a
 *  domain before spending anything. Deliberately generic — the printed set says
 *  so, so nobody mistakes it for the real one. */
export function templateBrandModel(domain: string, brand: string, competitors: string[]): BrandModel {
  return {
    brand,
    domain,
    aliases: [brand],
    // visible slots, never words that read like a real category or buyer: the
    // audit's brand model fills them from the site once a key is present
    category: "[your category]",
    icp: "[your buyers]",
    products: [],
    value_props: [],
    problems: [],
    competitors,
    language: "en",
  };
}

export interface PreviewOptions {
  domain: string;
  brandName: string;
  competitors: string[];
  /** false ⇒ --no-brand-model: template defaults, $0, no keys */
  useBrandModel: boolean;
  questionTemplates?: QuestionTemplateConfig | null;
  currentYear?: number;
  crawlPages?: number;
  onStage?: (line: string) => void;
}

export interface QuestionPreview {
  brandModel: BrandModel;
  /** GeneratedQuestions, not plain Question[]: carries `.skipped` when
   *  comparison/migration templates were left out for lack of a named rival
   *  (packages/engine/src/questions.ts) — printing that count is on the
   *  `saylent questions` / `audit --dry-run` command output, not here. */
  questions: GeneratedQuestions;
  version: number | string;
  usedBrandModel: boolean;
  pagesCrawled: number;
}

export async function previewQuestions(
  engineMod: PreviewEngine,
  opts: PreviewOptions,
): Promise<QuestionPreview> {
  const templates = opts.questionTemplates ?? undefined;
  const version = engineMod.templateSetVersion(templates);
  let brandModel: BrandModel;
  let pagesCrawled = 0;

  if (opts.useBrandModel) {
    opts.onStage?.("crawl");
    const pages = await engineMod.crawlSite(opts.domain, opts.crawlPages ?? 8, undefined, {
      fetcher: engineMod.safeFetch,
    });
    pagesCrawled = pages.length;
    opts.onStage?.("brand-model");
    brandModel = await engineMod.buildBrandModel(
      { brand: opts.brandName, domain: opts.domain, competitors: opts.competitors },
      pages,
      engineMod.brandModelCall,
    );
  } else {
    brandModel = templateBrandModel(opts.domain, opts.brandName, opts.competitors);
  }

  const questions = engineMod.generateQuestions(
    brandModel,
    opts.currentYear ?? new Date().getFullYear(),
    templates,
  );
  return { brandModel, questions, version, usedBrandModel: opts.useBrandModel, pagesCrawled };
}

/** "8 category · 5 comparison · 4 problem · ..." in first-seen order —
 * 's "question count by type" line, shared by `saylent
 *  questions` and `audit --dry-run`. */
export function typeCounts(questions: { qtype: string }[]): string {
  const counts = new Map<string, number>();
  for (const q of questions) counts.set(q.qtype, (counts.get(q.qtype) ?? 0) + 1);
  return [...counts.entries()].map(([qtype, n]) => `${n} ${qtype}`).join(` ${glyph("sep")} `);
}

/** The one-line-per-question block both commands print.
 *
 *  `selected` (optional) is the set of qids THIS profile will actually ask —
 *  `audit --dry-run` passes it so the 17 rows a smoke run will never ask are
 *  visibly different from the 6 it will. Omitted (the `saylent questions`
 *  case, which previews the whole library) the extra column is not printed at
 *  all, so nothing implies a selection that was never made. */
export function formatQuestionLines(
  questions: { qid: string; qtype: string; text: string; source?: string }[],
  scoredTypes: readonly string[],
  selected?: ReadonlySet<string>,
): string {
  const width = Math.max(...questions.map((q) => q.qtype.length), 6);
  return questions
    .map((q) => {
      const scored = scoredTypes.includes(q.qtype) ? "scored" : `     ${glyph("sep")}`;
      const mine = q.source === "user" ? " (yours)" : "";
      const mark = selected ? `${selected.has(q.qid) ? glyph("dot") : " "} ` : "";
      return `  ${mark}${q.qid}  ${scored}  ${q.qtype.padEnd(width)}  ${q.text}${mine}`;
    })
    .join("\n");
}
