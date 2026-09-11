// The blocked-domain gate. Two layers:
//   • matchBlockedDomain — pure matcher (a domain matches an entry when it IS the
//     entry or is a subdomain of it), so vitest can pin the semantics and both
//     createBrand and createRun share exactly one definition.
//   • blockedDomainReason — the async lookup: reads blocked_domains through the
//     SERVICE-ROLE client (the table is service-role-only — RLS grants
//     authenticated/anon nothing) and returns an honest, user-facing message when
//     the brand's domain is blocked, or null when it's clear.
import { createAdminClient } from "./supabase/admin";

/** Normalize to a bare, lowercased host: strip protocol, path, and a leading
 *  "www.". createBrand/validateBrandFields already store the bare host, but the
 *  matcher is defensive so the blocklist behaves the same on any caller. */
export function normalizeHost(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

/** Return the blocklist entry that matches `domain`, or null. A domain matches an
 *  entry when it equals the entry or is a subdomain of it (so blocking "acme.com"
 *  also blocks "shop.acme.com"). Pure — the DB read happens in the caller. */
export function matchBlockedDomain(domain: string, blocked: string[]): string | null {
  const host = normalizeHost(domain);
  if (!host) return null;
  for (const raw of blocked) {
    const entry = normalizeHost(raw);
    if (!entry) continue;
    if (host === entry || host.endsWith(`.${entry}`)) return entry;
  }
  return null;
}

/** Honest, user-facing refusal message for a blocked domain (rendered verbatim,
 *  same as the entitlement reasons), or null when the domain is allowed. Reads the
 *  full blocklist once and matches in-process — the list is tiny at this scale. */
export async function blockedDomainReason(domain: string): Promise<string | null> {
  const host = normalizeHost(domain);
  if (!host) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("blocked_domains").select("domain");
  const match = matchBlockedDomain(host, (data ?? []).map((r) => r.domain as string));
  if (!match) return null;
  return "We can't audit this domain. If you believe this is a mistake, contact support.";
}
