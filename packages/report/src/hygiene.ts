// Data-hygiene predicates (migration 0038). Pure so the rule "a hidden
// run / soft-deleted brand is excluded from every list" is one testable thing shared
// across pages. Most exclusion is done at the SQL layer (`.is("hidden_at", null)` /
// `.is("deleted_at", null)`, index-backed); this helper is used where a page fetches
// runs INCLUDING hidden ones in a single query and needs to split them (the brand
// Movement page shows visible runs above the fold and hidden runs in a small drawer).

/** A run is hidden when it carries a hidden_at timestamp. */
export function isHidden(row: { hidden_at?: string | null }): boolean {
  return row.hidden_at != null;
}

/** A brand is soft-deleted when it carries a deleted_at timestamp. */
export function isDeleted(row: { deleted_at?: string | null }): boolean {
  return row.deleted_at != null;
}

/** Split a run list into the ones users see (visible) and the ones tucked away
 *  (hidden), preserving input order within each bucket. */
export function partitionByHidden<T extends { hidden_at?: string | null }>(
  rows: T[],
): { visible: T[]; hidden: T[] } {
  const visible: T[] = [];
  const hidden: T[] = [];
  for (const r of rows) (isHidden(r) ? hidden : visible).push(r);
  return { visible, hidden };
}
