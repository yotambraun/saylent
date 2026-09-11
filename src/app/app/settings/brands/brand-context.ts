// TODO: surface brands.icp/problems as editable context — pure bounds for the
// editable buyer-context fields. Like the other brand inputs these flow into LLM
// prompts + storage, so cap length/shape before they are
// persisted. Pure (no Supabase/Next) → importable by the server action + unit-testable.

const ICP_MAX = 160;
const PROBLEM_MAX = 120;
export const MAX_PROBLEMS = 8;

/** Trim + collapse whitespace on the free-text ICP, bounded. Empty is allowed
 *  (clears the column back to the audit-derived value on the next run). */
export function parseIcp(
  input: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = (input ?? "").replace(/\s+/g, " ").trim();
  if (value.length > ICP_MAX) {
    return { ok: false, error: `Who buys you is too long (${ICP_MAX} characters max).` };
  }
  return { ok: true, value };
}

/** Parse the comma-separated problems into a bounded string[] — mirrors the
 *  competitors CSV pattern, with problem-specific caps + messages. */
export function parseProblems(
  csv: string,
): { ok: true; list: string[] } | { ok: false; error: string } {
  const list = (csv ?? "")
    .split(",")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (list.length > MAX_PROBLEMS) {
    return { ok: false, error: `Up to ${MAX_PROBLEMS} problems.` };
  }
  const tooLong = list.find((p) => p.length > PROBLEM_MAX);
  if (tooLong) {
    return { ok: false, error: `Each problem is too long (${PROBLEM_MAX} characters max).` };
  }
  return { ok: true, list };
}
