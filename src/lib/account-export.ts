// GDPR Art. 20 data-portability manifest. Pure so
// the /api/account/export route stays thin and the table list + filename are
// unit-tested. The route runs each SELECT on the caller's RLS client, so it can
// only ever read the caller's own rows (defense in depth on top of the explicit
// user_id filter). Every table below has an owner-scoped RLS SELECT policy AND a
// user_id column.

/** The user-owned tables included in a data export, in document order. */
export const EXPORT_TABLES = [
  "brands",
  "runs", // includes the scores column (verdict/movement)
  "answers", // includes per-engine verdicts
  "corpus_pages",
  "domain_checks",
  "fixes",
  "notifications",
  "credit_ledger",
] as const;

export type ExportTable = (typeof EXPORT_TABLES)[number];

/** Download filename, date-stamped (YYYY-MM-DD) for a stable, sortable name. */
export function buildExportFilename(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  return `saylent-export-${stamp}.json`;
}
