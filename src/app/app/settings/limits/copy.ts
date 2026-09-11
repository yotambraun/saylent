// Pure copy helpers for Settings › Limits — "your limits, set by your operator".
// There are no plans, no credits and no prices in this product, so every line
// here describes a guardrail the operator configured. Split out from page.tsx so
// the wording is unit-testable without mocking Supabase.

export function spendCapCopy(dailySpendCapUsd: number): string {
  return dailySpendCapUsd > 0
    ? `$${dailySpendCapUsd.toFixed(0)} / day, deployment-wide.`
    : "No cap set.";
}

export function fairUseCopy(
  maxAuditsPerWindow: number,
  maxVerifiesPerWindow: number,
  throttleWindowHours: number,
): string {
  return `Up to ${maxAuditsPerWindow} audits and ${maxVerifiesPerWindow} verifies per brand every ${throttleWindowHours} hours; one run at a time per brand.`;
}

export function brandLimitCopy(brandLimit: number): string {
  return `${brandLimit} brand${brandLimit === 1 ? "" : "s"} per account.`;
}
