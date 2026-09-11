// Central branding config so a self-hosted deployment shows its own product name
// and contact address instead of ours. See METHODOLOGY.md / ARCHITECTURE.md.
// Both values are public envs (inlined at build time), so plain client components
// can read the exported constants with no server dependency.
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Saylent";

// FAILS CLOSED, like NEXT_PUBLIC_OPERATOR_NAME on /privacy and /terms. This used
// to fall back to `hello@example.com`, which meant the PUBLIC share page for a
// real, named third-party brand printed a fake correction address — the single worst place in the product for a placeholder. Unset now
// means null, and every caller says "the operator of this deployment" instead of
// inventing a mailbox.
export const CONTACT_EMAIL: string | null =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null;

/** Where to report a bug in the SOFTWARE (not in a report's contents, and not to
 *  this deployment's operator). Always available: it is the project, not the
 *  deployment. */
export const PROJECT_ISSUES_URL = "https://github.com/yotambraun/saylent/issues";

/** "…at name@example.com" / "…the operator of this deployment" — the one
 *  sentence fragment every caller needs, so none of them re-invents a fallback. */
export function contactPhrase(): string {
  return CONTACT_EMAIL ?? "the operator of this deployment";
}
