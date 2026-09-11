// Stopword-stripped token-overlap coverage (see METHODOLOGY.md):
// score = |q∩page| / |q| against every page's title + first-4k text;
// best < COVERAGE_THRESHOLD ⇒ the question is uncovered on the site.
const STOPWORDS = new Set(
  ("a an and are as at be best by can do for from has have how i in is it my of on or " +
    "that the this to was we what which who why will with you your not any our so").split(" "),
);

// Calibrated default (tuned on internal runs). Override it with
// `thresholds.coverage` in saylent.config.* — coverageThreshold() below is the
// ONE place that override is applied, and an absent config keeps 0.45 exactly.
export const COVERAGE_THRESHOLD = 0.45;

/** The threshold this run judges coverage at: the saylent.config
 *  `thresholds.coverage` value when the project set one (0-1), else the
 *  calibrated default. An out-of-range or non-finite value is ignored rather
 *  than silently making every question "covered". */
export function coverageThreshold(override?: number | null): number {
  if (typeof override !== "number" || !Number.isFinite(override)) return COVERAGE_THRESHOLD;
  if (override < 0 || override > 1) return COVERAGE_THRESHOLD;
  return override;
}

export function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

export function coverageScore(question: string, pageTitle: string, pageText: string): number {
  const q = tokenize(question);
  if (q.size === 0) return 1;
  const page = tokenize(`${pageTitle} ${pageText.slice(0, 4000)}`);
  let hit = 0;
  for (const t of q) if (page.has(t)) hit++;
  return hit / q.size;
}

/** best score across pages; a question is covered if any page reaches the threshold */
export function bestCoverage(
  question: string,
  pages: { title: string; text: string }[],
): number {
  let best = 0;
  for (const p of pages) {
    const s = coverageScore(question, p.title, p.text);
    if (s > best) best = s;
    if (best >= 1) break;
  }
  return best;
}
