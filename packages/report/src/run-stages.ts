// RUNNING-mode checklist (EXACT labels) — shared so the run view
// AND the global run pill speak one vocabulary and compute progress the
// same way. Extracted from run-view.tsx so neither duplicates the stage list or
// the index math. Pure + SSR-safe.

export const STAGES = [
  "Crawling your site",
  "Building your brand model",
  "Asking ChatGPT",
  "Asking Claude",
  "Asking Gemini",
  "Asking Perplexity",
  "Reading the pages the engines cited",
  "Testing your site's gates",
  "Writing your fix plan",
] as const;

export interface ParsedStage {
  /** the canonical stage label (matched against STAGES), e.g. "Asking Gemini" */
  label: string;
  /** any live detail after the " · ", e.g. "3/6 answered" (may be "") */
  detail: string;
  /** index of label in STAGES, or -1 when the stage is off-list */
  index: number;
}

// stage strings may carry live detail: "Asking Gemini · 3/6 answered"
export function parseStage(stage: string | null | undefined): ParsedStage {
  const [label, ...detailParts] = (stage ?? "").split(" · ");
  return {
    label,
    detail: detailParts.join(" · "),
    index: STAGES.indexOf(label as (typeof STAGES)[number]),
  };
}

/** Progress as a 0–100 whole number: done ⇒ 100, a known stage ⇒ its midpoint,
 * anything else (queued / off-list) ⇒ a small non-zero sliver so the bar reads
 * as "started". Mirrors the math that lived inline in run-view.tsx. */
export function runProgressPct(stage: string | null | undefined, status: string): number {
  if (status === "done") return 100;
  const { index } = parseStage(stage);
  if (index >= 0) return Math.round(((index + 0.5) / STAGES.length) * 100);
  return 4;
}
