// "WHAT'S FOLLOWING YOU" — the Living-Asset panel behind the Movement page.
// Data-gold audit finding #3: rival identity and objection themes PERSIST across
// a brand's comparable audits but are never composed longitudinally. This module
// does exactly that composition — nothing else, purely:
//
//   1. Persistent rivals — per rival (from every answer's verdict.other_brands),
//      its SHARE of that run's total rival mentions, run by run. Rates, never raw
//      counts: run sizes differ, so a naive count diff would mislead (one rival
//      held a stable ~1-in-5 share of the brand's rival mentions across 3 audits
//      even as the raw counts moved). Direction is stated only when the share
//      moved past a meaningful threshold; small wobbles read as "steady".
//   2. Persistent objections — risk claims (verdict.claims kind="risk") that
//      recur in ≥2 of the comparable audits, matched by EXACT normalized text.
//      The semantic-clustering upgrade (grouping "slow" ~ "sluggish") is
//      deliberately NOT built here — it would cost LLM spend; this is the cheap,
//      honest tier.
//
// The comparable set is chosen with the SAME honesty rule the Pulse stands on
// (pulse.ts areRunsComparable / comparableRunIds) — never across a profile or a
// re-baseline (question-set) boundary. <2 comparable audits ⇒ null (no panel).
//
// Pure module: no React/Supabase/Next. Reuses verdict-compat's normalizers so
// both old (`string[]`) and new (`{name,why}` / `{text,kind}`) DB verdict shapes
// are read identically to every other reader. @saylent/engine is a real
// workspace package, so this resolves at test runtime like any other import
// (open-source split, 2026-09-09).
import { normClaims, normOtherBrands } from "@saylent/engine/verdict-compat";
import { areRunsComparable, comparableRunIds, type PulseRun } from "./pulse";

/** Minimal answer slice this module needs: the run it belongs to plus the two
 * verdict jsonb fields it composes. `claims` / `other_brands` are read raw and
 * normalized here, so both DB shapes are handled (see verdict-compat). */
export interface FollowingAnswerRow {
  run_id: string;
  claims: unknown;
  other_brands: unknown;
}

export interface PersistentRival {
  /** display name (verbatim, from the newest audit it appears in) */
  name: string;
  /** how many of the cohort's audits named this rival at least once */
  runsPresent: number;
  /** cohort size (audits compared) */
  cohortSize: number;
  /** mean per-run share of that run's total rival mentions, over runs present */
  avgShare: number;
  /** ready-to-render honest sentence */
  sentence: string;
}

export interface PersistentObjection {
  /** the risk claim, verbatim (from the newest audit it appears in) */
  claim: string;
  runsPresent: number;
  cohortSize: number;
  sentence: string;
}

export interface FollowingView {
  /** the comparable audit set actually used, newest first */
  cohortRunIds: string[];
  rivals: PersistentRival[];
  objections: PersistentObjection[];
}

// ── tuning knobs (stated, not magic) ────────────────────────────────────────
// A rival/objection is "persistent" once it recurs in at least this many audits.
const MIN_PERSIST = 2;
// Direction is only claimed when a rival's share moved by ≥ this much between the
// oldest and newest audit it appears in. 0.10 = ten percentage points of "share
// of all rival mentions" — anything smaller is honest run-to-run noise ("steady").
const SHARE_MOVE = 0.1;
// Never surface more than this many of each (2–3 is the honest ceiling per spec).
const CAP = 3;
// Objection text is trimmed to this many chars for the one-line sentence.
const CLAIM_MAX = 110;

/**
 * The comparable audit cohort for the Living-Asset panel: the (profile + frozen
 * question-set) group that the NEWEST comparable run belongs to, as run ids
 * newest-first. `[]` when no group has ≥2 comparable runs. Built strictly on
 * pulse.ts's rules — a smoke/full boundary or a re-baseline splits groups, so a
 * cohort is never mixed across either. Mirrors the Pulse auto-pair's "newest run
 * that has a comparable partner" anchor, but returns the whole group, not a pair.
 */
export function comparableCohort(
  runs: PulseRun[],
  questionKeyByRun: Record<string, string>,
): string[] {
  const ids = comparableRunIds(runs, questionKeyByRun); // newest-first, each has ≥1 partner
  if (ids.length < MIN_PERSIST) return [];
  const byId = new Map(runs.map((r) => [r.id, r]));
  const anchor = byId.get(ids[0]);
  if (!anchor) return [];
  // The anchor's group = every offered run comparable to it (same profile + key).
  return ids.filter((id) => {
    const r = byId.get(id);
    return !!r && (r.id === anchor.id || areRunsComparable(anchor, r, questionKeyByRun));
  });
}

/** "~1 in 5 rival mentions" for smallish shares; a percentage once a rival owns
 * roughly half or more (where "1 in 1" would read as nonsense). */
function shareText(avg: number): string {
  if (avg >= 0.45) return `~${Math.round(avg * 100)}% of rival mentions`;
  const x = Math.max(2, Math.round(1 / avg));
  return `~1 in ${x} rival mentions`;
}

/** "all 3 audits" when in every cohort run, else "M of N audits". */
function auditsPhrase(present: number, total: number): string {
  return present === total ? `all ${total} audits` : `${present} of ${total} audits`;
}

const normText = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Compose the Living-Asset view for a brand, or null when there is nothing
 * honest to show (fewer than {@link MIN_PERSIST} comparable audits). `answers`
 * may contain rows outside the cohort — they are ignored (the page fetches only
 * cohort rows, but this stays correct regardless). `brandAliases` names the
 * audited brand's own aliases so it is never listed as its own rival.
 */
export function computeFollowing(
  runs: PulseRun[],
  questionKeyByRun: Record<string, string>,
  answers: FollowingAnswerRow[],
  brandAliases: string[],
): FollowingView | null {
  const cohort = comparableCohort(runs, questionKeyByRun); // newest-first
  if (cohort.length < MIN_PERSIST) return null;
  const cohortIndex = new Map(cohort.map((id, i) => [id, i])); // 0 = newest
  const aliasSet = new Set(brandAliases.map((a) => a.trim().toLowerCase()).filter(Boolean));

  // ── per-run aggregation (cohort rows only) ──────────────────────────────
  // rivals: run → (lowercase name → {display, count}); plus total mentions/run.
  const rivalByRun = new Map<string, Map<string, { display: string; count: number }>>();
  const rivalTotalByRun = new Map<string, number>();
  // objections: run → (normalized risk text → verbatim display), a SET per run
  // (a claim repeated within one audit still counts once for that audit).
  const riskByRun = new Map<string, Map<string, string>>();
  for (const id of cohort) {
    rivalByRun.set(id, new Map());
    rivalTotalByRun.set(id, 0);
    riskByRun.set(id, new Map());
  }

  for (const a of answers) {
    if (!cohortIndex.has(a.run_id)) continue;
    const rivals = rivalByRun.get(a.run_id)!;
    for (const ob of normOtherBrands(a)) {
      const key = ob.name.toLowerCase();
      if (aliasSet.has(key)) continue; // the brand is not its own rival
      const cur = rivals.get(key) ?? { display: ob.name, count: 0 };
      cur.count += 1;
      rivals.set(key, cur);
      rivalTotalByRun.set(a.run_id, (rivalTotalByRun.get(a.run_id) ?? 0) + 1);
    }
    const risks = riskByRun.get(a.run_id)!;
    for (const c of normClaims(a)) {
      if (c.kind !== "risk") continue;
      const key = normText(c.text);
      if (key && !risks.has(key)) risks.set(key, c.text.trim());
    }
  }

  const cohortSize = cohort.length;
  const newestDisplay = <T>(pick: (runId: string) => T | undefined): T | undefined => {
    for (const id of cohort) {
      const v = pick(id); // cohort is newest-first
      if (v !== undefined) return v;
    }
    return undefined;
  };

  // ── persistent rivals ───────────────────────────────────────────────────
  const rivalKeys = new Set<string>();
  for (const m of rivalByRun.values()) for (const k of m.keys()) rivalKeys.add(k);

  type RivalAgg = {
    key: string;
    display: string;
    runsPresent: number;
    totalMentions: number;
    avgShare: number;
    newestShare: number;
    oldestShare: number;
  };
  const rivalAggs: RivalAgg[] = [];
  for (const key of rivalKeys) {
    const shares: { idx: number; share: number }[] = [];
    let totalMentions = 0;
    for (const id of cohort) {
      const hit = rivalByRun.get(id)!.get(key);
      if (!hit) continue;
      const total = rivalTotalByRun.get(id) ?? 0;
      if (total <= 0) continue;
      totalMentions += hit.count;
      shares.push({ idx: cohortIndex.get(id)!, share: hit.count / total });
    }
    if (shares.length < MIN_PERSIST) continue; // not persistent
    const avgShare = shares.reduce((s, x) => s + x.share, 0) / shares.length;
    // cohortIndex 0 = newest → smallest idx is newest, largest idx is oldest.
    const newestShare = shares.reduce((a, b) => (b.idx < a.idx ? b : a)).share;
    const oldestShare = shares.reduce((a, b) => (b.idx > a.idx ? b : a)).share;
    const display = newestDisplay((id) => rivalByRun.get(id)!.get(key)?.display) ?? key;
    rivalAggs.push({
      key,
      display,
      runsPresent: shares.length,
      totalMentions,
      avgShare,
      newestShare,
      oldestShare,
    });
  }

  // "most-named alternative" = the persistent rival with the most total mentions
  // across the cohort (deterministic tiebreak: name asc).
  const mostNamedKey = [...rivalAggs].sort(
    (a, b) => b.totalMentions - a.totalMentions || a.display.localeCompare(b.display),
  )[0]?.key;

  const rivals: PersistentRival[] = rivalAggs
    // surface order: most audits present, then most mentions, then name
    .sort(
      (a, b) =>
        b.runsPresent - a.runsPresent ||
        b.totalMentions - a.totalMentions ||
        a.display.localeCompare(b.display),
    )
    .slice(0, CAP)
    .map((r) => {
      const move = r.newestShare - r.oldestShare;
      const EPS = 1e-9; // guard exact-threshold cases from float error (.3−.2)
      const dir =
        move >= SHARE_MOVE - EPS
          ? ". Its share is climbing"
          : move <= -(SHARE_MOVE - EPS)
            ? ". Its share is easing"
            : ""; // steady: no direction claimed
      const role = r.key === mostNamedKey ? "your most-named alternative" : "a recurring alternative";
      return {
        name: r.display,
        runsPresent: r.runsPresent,
        cohortSize,
        avgShare: r.avgShare,
        sentence: `${r.display} has been ${role} in ${auditsPhrase(
          r.runsPresent,
          cohortSize,
        )} (${shareText(r.avgShare)})${dir}.`,
      };
    });

  // ── persistent objections ───────────────────────────────────────────────
  const riskKeys = new Set<string>();
  for (const m of riskByRun.values()) for (const k of m.keys()) riskKeys.add(k);

  type ObjAgg = { key: string; display: string; runsPresent: number; oldestIdx: number };
  const objAggs: ObjAgg[] = [];
  for (const key of riskKeys) {
    let runsPresent = 0;
    let oldestIdx = -1;
    for (const id of cohort) {
      if (riskByRun.get(id)!.has(key)) {
        runsPresent += 1;
        oldestIdx = Math.max(oldestIdx, cohortIndex.get(id)!);
      }
    }
    if (runsPresent < MIN_PERSIST) continue;
    const display = newestDisplay((id) => riskByRun.get(id)!.get(key)) ?? key;
    objAggs.push({ key, display, runsPresent, oldestIdx });
  }

  const trim = (s: string) => (s.length > CLAIM_MAX ? `${s.slice(0, CLAIM_MAX - 1).trimEnd()}…` : s);
  const objections: PersistentObjection[] = objAggs
    // surface order: most audits present, then longest-standing (oldest first), then text
    .sort(
      (a, b) =>
        b.runsPresent - a.runsPresent ||
        b.oldestIdx - a.oldestIdx ||
        a.display.localeCompare(b.display),
    )
    .slice(0, CAP)
    .map((o) => ({
      claim: o.display,
      runsPresent: o.runsPresent,
      cohortSize,
      sentence: `The "${trim(o.display)}" objection has appeared in ${auditsPhrase(
        o.runsPresent,
        cohortSize,
      )}. Still unaddressed.`,
    }));

  // Nothing persistent at all ⇒ no panel (honest empty state).
  if (rivals.length === 0 && objections.length === 0) return null;
  return { cohortRunIds: cohort, rivals, objections };
}
