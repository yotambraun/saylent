// The agent gets the same Brief blocks as JSON. This turns
// a lossless run.json bundle into exactly the Brief the report.md/report.html
// lead layer is composed from (brief.ts buildBrief) — same composer, same
// numbers, same receipt handles, so an answer an agent reads here can never
// disagree with the report a human opens.
//
// The bundle -> BriefInput mapping is the SAME one render/markdown.ts does
// (reportDataFromBundle first, so synthetic row ids match the receipts the
// HTML report's drawers resolve, then the cast-only run fields from-bundle.ts
// documents). It is repeated here rather than imported because markdown.ts
// composes its Brief privately and only returns rendered Markdown; the MCP
// server needs the block union itself, as JSON.
import type { RunBundleV1 } from "@saylent/engine/bundle";
import type { Brief, BriefInput, BriefScores } from "@saylent/report/brief";
import type { ReportData } from "@saylent/report/render/types";

export type BuildBriefFn = (input: BriefInput) => Brief;
export type ReportDataFromBundleFn = (bundle: RunBundleV1) => ReportData;

/** The Brief (hero + self-hiding question cards + typed blocks) for one run. */
export function briefFromBundle(
  bundle: RunBundleV1,
  reportDataFromBundle: ReportDataFromBundleFn,
  buildBrief: BuildBriefFn,
): Brief {
  const data = reportDataFromBundle(bundle);
  const { run, brand, answers, corpus, checks, fixes } = data;
  const runRow = run as unknown as {
    scores?: BriefScores | null;
    health?: unknown;
    site_pages?: unknown;
    brand_model?: { value_props?: unknown } | null;
    kind?: string;
  };
  return buildBrief({
    brand,
    scores: (runRow.scores ?? null) as BriefScores | null,
    answers: answers as never,
    corpus: corpus as never,
    checks: checks as never,
    fixes: fixes as never,
    health: (runRow.health ?? null) as never,
    sitePages: (runRow.site_pages ?? null) as never,
    valueProps: Array.isArray(runRow.brand_model?.value_props)
      ? (runRow.brand_model?.value_props as unknown[]).filter((v): v is string => typeof v === "string")
      : [],
    kind: runRow.kind,
    previous: null,
  });
}

/** The section names `read_report`'s `section` argument accepts: "hero" plus
 *  every card id the run actually produced (cards self-hide, so a thin run
 *  offers fewer). */
export function sectionNames(brief: Brief): string[] {
  return ["hero", ...brief.cards.map((c) => c.id)];
}

/** One named slice of the Brief, or null when the name matches nothing.
 *  Matching is case-insensitive and accepts a card's anchor as well as its id,
 *  since an agent reading a report link sees the anchor. */
export function briefSection(brief: Brief, section: string): unknown | null {
  const wanted = section.trim().toLowerCase().replace(/^#/, "");
  if (wanted === "hero" || wanted === "verdict") return { story: brief.story, hero: brief.hero };
  const card = brief.cards.find(
    (c) => c.id.toLowerCase() === wanted || c.anchor.toLowerCase().replace(/^#/, "") === wanted,
  );
  return card ?? null;
}
