// "First sign-up is the operator" — on a
// self-hosted deployment migration 0040 promotes the first profile to
// role='admin'. That person meets the product at /app/onboarding, and the only
// thing they need told once is that this deployment is theirs to run.
//
// Pure predicate so the condition is pinned by vitest (the page itself is a
// server component that reads Supabase). Deliberately narrow: the card shows on
// the operator's FIRST visit only — an admin who already has a brand, and every
// non-admin, sees the unchanged onboarding page.
export function shouldShowOperatorCard(input: {
  role: string | null | undefined;
  brandCount: number | null | undefined;
}): boolean {
  return input.role === "admin" && (input.brandCount ?? 0) === 0;
}
