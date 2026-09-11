// Pure logic for the cross-run fix queue. Dedupe by
// (brand_id, normalizeFixKey(fix_key)) with the LATEST occurrence's fields
// winning; lifecycle Open → Shipped (published_at set) → Watched (a verify ran
// after shipping — its watch note shown verbatim). This closes the action→outcome
// loop no competitor has (Peec's Actions stop at "mark done").
//
// ROOT-CAUSE (the "looks like seed data" smell): every engine-emitted
// fix_key EXCEPT the source pitches is stable across runs ("access", "coverage-hub",
// "schema_missing", "claims", "citation-longtail", "citation-competitor-owned",
// "entity_unclear", "freshness_stale") — those already collapse to one row per brand.
// The one that DRIFTS is `source-{host}` (src/engine/fixes.ts::diagnose): host comes
// from hostOf() which keeps a leading "www." (stripWww is only applied for the
// rival-owner lookup, never to the key). So the SAME outlet surfaces as
// `source-www.g2.com` in one run and `source-g2.com` in another → two "distinct"
// fixes for one logical outlet, i.e. the repetition the tracker showed. normalizeFixKey
// canonicalises those (lowercase host, strip a leading "www.") so both fold into one
// consolidated row — and, because the win rate counts consolidated rows, a fix can no
// longer be double-counted as two watched outcomes.

/** Canonical grouping key for a fix. Stable keys pass through unchanged; only the
 *  drifting `source-{host}` family is normalised (host lowercased + leading "www."
 *  stripped) so one logical outlet is one row across runs. Pure + exported for tests. */
export function normalizeFixKey(fixKey: string): string {
  const SOURCE = "source-";
  if (!fixKey.startsWith(SOURCE)) return fixKey;
  const host = fixKey.slice(SOURCE.length).toLowerCase().replace(/^www\./, "");
  return `${SOURCE}${host}`;
}

export interface TrackerFixRow {
  id: string;
  fix_key: string;
  title: string;
  factor: string;
  weight: string | number;
  effort: string;
  published_at: string | null;
  run_id: string;
  brand_id: string;
  run_created_at: string;
  has_artifact: boolean;
  evidence: string[];
  // engines this fix affects (fixes.engines, stored since 0006 but never surfaced
  // in the UI until the tracker's "affects:" chip). Optional: pre-existing callers
  // that don't select it still type-check.
  engines?: string[];
}

export interface TrackerVerify {
  brand_id: string;
  created_at: string;
  // newlyPresentQids: qids that newly name the brand after shipping — its length
  // (>0) is the honest "moved a metric" signal we aggregate into the win rate.
  watch_notes: { fixKey: string; note: string; newlyPresentQids?: string[] }[];
}

export interface TrackedFix {
  id: string;
  fix_key: string;
  title: string;
  factor: string;
  weight: number;
  effort: string;
  brand_id: string;
  run_id: string;
  occurrences: number;
  /** run_created_at of the FIRST audit this fix appeared in ("seen since"). */
  first_seen: string;
  /** run_created_at of the LATEST audit this fix appeared in — the row's own
   *  run_id points at that same latest occurrence's dossier. */
  last_seen: string;
  has_artifact: boolean;
  evidence: string[];
  engines: string[];
  published_at: string | null;
  status: "open" | "shipped" | "watched";
  watch_note: string | null;
  // whether the post-ship verify recorded newly-present qids for this fix
  // (>0 = it moved a metric). null until a verify has watched it.
  moved: boolean | null;
}

// STATUS PRECEDENCE across a fix's occurrences (design note for the brief
// that asked for "shipped > watched > open"). The three states are NOT peers
// on one axis — they are a strict lifecycle: open → shipped → watched, where
// `watched` PROVES `shipped` (a verify can only watch a fix that was already
// shipped). So the honest "which state wins when occurrences disagree" order is the
// FURTHEST state reached: watched > shipped > open. Concretely: shipped if ANY
// occurrence carries a published_at (the mark lives on one run's row); watched if,
// on top of that, a post-ship verify for the brand exists; open otherwise. (The
// brief's literal "shipped > watched > open" would rank a re-measured fix BELOW a
// merely-shipped one, which is backwards — watched is strictly more done. STATUS_ORDER
// below is the queue SORT order: unfinished work, open first.)
const STATUS_ORDER = { open: 0, shipped: 1, watched: 2 } as const;

export function trackFixes(
  fixes: TrackerFixRow[],
  verifies: TrackerVerify[],
): TrackedFix[] {
  // Group by (brand_id, NORMALISED fix_key) so a source pitch that drifted between
  // www./non-www hosts across runs is one logical fix, not two (see normalizeFixKey).
  const groups = new Map<string, TrackerFixRow[]>();
  for (const f of fixes) {
    const key = `${f.brand_id} ${normalizeFixKey(f.fix_key)}`;
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }

  const out: TrackedFix[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => a.run_created_at.localeCompare(b.run_created_at));
    const latest = g[g.length - 1];
    const normKey = normalizeFixKey(latest.fix_key);
    // shipped if ANY occurrence was marked shipped (mark lives on one run's row)
    const shippedAt = g
      .map((f) => f.published_at)
      .filter((p): p is string => p !== null)
      .sort()
      .pop() ?? null;

    let status: TrackedFix["status"] = shippedAt ? "shipped" : "open";
    let watchNote: string | null = null;
    let moved: boolean | null = null;
    if (shippedAt) {
      const postShip = verifies
        .filter((v) => v.brand_id === latest.brand_id && v.created_at > shippedAt)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      const lastVerify = postShip[postShip.length - 1];
      if (lastVerify) {
        status = "watched";
        // Match the verify's note by NORMALISED key too — the note's fixKey is the
        // engine's raw `source-{host}` and can carry the same www drift.
        const note = lastVerify.watch_notes.find((w) => normalizeFixKey(w.fixKey) === normKey);
        watchNote = note?.note ?? null;
        // watched but no note for this fix ⇒ verified, no movement recorded (false)
        moved = (note?.newlyPresentQids?.length ?? 0) > 0;
      }
    }

    out.push({
      id: latest.id,
      // canonical key so the source-cluster host chips render one form, not two
      fix_key: normKey,
      title: latest.title,
      factor: latest.factor,
      weight: Number(latest.weight),
      effort: latest.effort,
      brand_id: latest.brand_id,
      run_id: latest.run_id,
      occurrences: g.length,
      first_seen: g[0].run_created_at,
      last_seen: latest.run_created_at,
      has_artifact: latest.has_artifact,
      evidence: latest.evidence,
      engines: latest.engines ?? [],
      published_at: shippedAt,
      status,
      watch_note: watchNote,
      moved,
    });
  }

  return out.sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.weight - a.weight,
  );
}

/**
 * Honest win-rate aggregate for watched fixes: how many verified fixes actually
 * moved a metric (a post-ship verify found the brand newly present on ≥1 qid).
 * Counts-first — pct is null below n=3 so we never quote a percentage off a
 * sample too small to mean anything (see METHODOLOGY.md).
 *
 * NO DOUBLE-COUNT: this runs over trackFixes() output — already ONE row per
 * (brand, normalised fix_key). Before normalizeFixKey, a source pitch that drifted
 * www./non-www across runs would surface as two watched rows and be counted twice
 * here; consolidation collapses it to one, so each logical fix contributes exactly
 * one watched (and at most one moved) tally.
 */
export function fixWinRate(fixes: TrackedFix[]): {
  watched: number;
  moved: number;
  pct: number | null;
} {
  const watched = fixes.filter((f) => f.status === "watched").length;
  const moved = fixes.filter((f) => f.moved === true).length;
  return { watched, moved, pct: watched >= 3 ? Math.round((moved / watched) * 100) : null };
}
