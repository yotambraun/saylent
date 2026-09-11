// "Your next move" — pure, priority-ordered computation of the ≤3 nudge cards
// shown at the top of /app (the "smart home" upgrade). Fed entirely by data the
// dashboard already fetches; zero LLM/engine cost. Editorial + honest voice:
// warm process copy, every state truthful, counts in plain language. Never a
// credit number or meter: the state of the work, and the right CTA.
//
// Priority order (take the top 3 after per-brand de-dupe):
//   1. active run            → OWNED BY the Right-now strip, never a move here
//   2. no brands at all      → the single first-audit card (the ONLY card)
//   3. failed latest run     → retry (per brand)
//   4. drafted fixes waiting → ship them (aggregate, one card)
//   5. verify available      → run verify (per brand)
//   6. latest verify moved   → see the movement (per brand)
//
// Verify has no waiting period and no plan tier: src/lib/runs.ts refuses a
// verify for exactly one reason, "no completed audit to compare against". So
// this helper offers the move as soon as a brand has a done audit, and there is
// no "verify unlocks on <weekday>" state left to render.

export type NextMoveKind =
  | "first-audit"
  | "retry"
  | "drafted-fixes"
  | "verify-open"
  | "verify-movement";

export interface NextMove {
  /** stable React key */
  key: string;
  kind: NextMoveKind;
  /** the one warm sentence */
  text: string;
  /** the arrow-link label */
  cta: string;
  href: string;
}

export interface NextMoveRun {
  id: string;
  brand_id: string;
  kind: string; // "audit" | "verify"
  status: string; // "queued" | "running" | "done" | "failed"
  created_at: string;
  finished_at: string | null;
  baseline_run_id: string | null;
  scores?: {
    verify?: { watch_notes?: { newlyPresentQids?: string[] }[] } | null;
  } | null;
}

export interface NextMovesInput {
  /** server render time (Date.now()); explicit so any date math is testable */
  now: number;
  /** accepted for the caller's shape; no move depends on a plan any more */
  plan?: string;
  /** open fixes (unpublished) that already have a drafted artifact */
  draftedFixes: number;
  brands: { id: string; name: string }[];
  runs: NextMoveRun[];
}

const newestFirst = (a: { created_at: string }, b: { created_at: string }) =>
  b.created_at.localeCompare(a.created_at);

/** Latest done audit for a brand — the verify baseline (see runs.ts). */
function baselineFor(runs: NextMoveRun[], brandId: string): NextMoveRun | null {
  return (
    runs
      .filter((r) => r.brand_id === brandId && r.kind === "audit" && r.status === "done")
      .sort((a, b) =>
        (b.finished_at ?? b.created_at).localeCompare(a.finished_at ?? a.created_at),
      )[0] ?? null
  );
}

/** Distinct qids that newly name the brand in its latest done verify run. */
function movementCount(runs: NextMoveRun[], brandId: string): number {
  const verify = runs
    .filter((r) => r.brand_id === brandId && r.kind === "verify" && r.status === "done")
    .sort(newestFirst)[0];
  if (!verify) return 0;
  const qids = new Set<string>();
  for (const note of verify.scores?.verify?.watch_notes ?? []) {
    for (const q of note.newlyPresentQids ?? []) qids.add(q);
  }
  return qids.size;
}

export function computeNextMoves(input: NextMovesInput): NextMove[] {
  const { draftedFixes, brands, runs } = input;

  // 2) No brands → the single first-audit card, and nothing else.
  if (brands.length === 0) {
    return [
      {
        key: "first-audit",
        kind: "first-audit",
        text: "Run your first audit: about ten minutes.",
        cta: "Start",
        href: "/app/onboarding",
      },
    ];
  }

  const moves: NextMove[] = [];
  // A brand contributes at most one move — its highest-priority one. (The
  // aggregate drafted-fixes card is brand-agnostic and never de-duped.)
  const used = new Set<string>();

  // 1) A brand with a live run is owned entirely by the Right-now strip — it
  //    surfaces no move here (a "run verify" nudge while a run is in flight
  //    would be dishonest).
  for (const b of brands) {
    if (runs.some((r) => r.brand_id === b.id && (r.status === "queued" || r.status === "running"))) {
      used.add(b.id);
    }
  }

  // 3) Failed latest run (per brand).
  for (const b of brands) {
    if (used.has(b.id)) continue;
    const latest = runs.filter((r) => r.brand_id === b.id).sort(newestFirst)[0];
    if (!latest) continue;
    if (latest.status === "failed") {
      moves.push({
        key: `retry:${b.id}`,
        kind: "retry",
        text: `${b.name}'s last run hit a wall. You were not charged. Retry.`,
        cta: "Retry",
        href: `/app/run/${latest.id}`,
      });
      used.add(b.id);
    }
  }

  // 4) Drafted fixes waiting (aggregate).
  if (draftedFixes > 0) {
    moves.push({
      key: "drafted-fixes",
      kind: "drafted-fixes",
      text:
        draftedFixes === 1
          ? "1 drafted fix is waiting: ship it."
          : `${draftedFixes} drafted fixes are waiting: ship them.`,
      cta: "Open the tracker",
      href: "/app/fixes",
    });
  }

  // 5) Verify available: the brand has a completed audit to compare against,
  //    which is the only condition runs.ts puts on a verify. No wait, no tier.
  //    A verify that already ran against this baseline is skipped so the card
  //    does not repeat a move the user has made; the movement card below is the
  //    honest next step in that case.
  for (const b of brands) {
    if (used.has(b.id)) continue;
    const baseline = baselineFor(runs, b.id);
    if (!baseline) continue;
    const alreadyRan = runs.some(
      (r) => r.kind === "verify" && r.status !== "failed" && r.baseline_run_id === baseline.id,
    );
    if (alreadyRan) continue;
    moves.push({
      key: `verify-open:${b.id}`,
      kind: "verify-open",
      text: `${b.name}'s audit is done. Run verify to measure your shipped fixes.`,
      cta: "Run verify",
      href: `/app/run/${baseline.id}`,
    });
    used.add(b.id);
  }

  // 6) Latest verify showed movement.
  for (const b of brands) {
    if (used.has(b.id)) continue;
    const n = movementCount(runs, b.id);
    if (n > 0) {
      moves.push({
        key: `verify-movement:${b.id}`,
        kind: "verify-movement",
        text: `Since you shipped: ${n} answer${n === 1 ? "" : "s"} now name you.`,
        cta: "See the movement",
        href: `/app/brand/${b.id}`,
      });
      used.add(b.id);
    }
  }

  return moves.slice(0, 3);
}
