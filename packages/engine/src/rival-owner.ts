// Shared rival-ownership guard (extracted from src/engine/fixes.ts E1b so the
// dossier UI and the engine agree on ONE definition of "this page is owned by a
// competitor"). Client-bundle-safe: pure string logic only — no engine/util
// import (that module carries node:dns), so the tiny archive-unwrap regex is
// duplicated here verbatim (source of truth documented both sides).
//
// A page is competitor-owned when its registrable domain contains a competitor
// token (≥4 chars from canonicalBrand — conservative, avoids "Box"→dropbox.com
// false positives) OR when a competitor's own domain REDIRECTS into it
// (sendgrid.com → twilio.com proves Twilio owns SendGrid even when "twilio" is
// nowhere in the competitor list).
import { canonicalBrand } from "./score";

// Keep in sync with ARCHIVE_WRAP in src/engine/util.ts (pure, unit-tested there).
const ARCHIVE_WRAP = /^https?:\/\/web\.archive\.org\/web\/\d+(?:id_)?\/(https?:\/\/.+)$/;
const unwrapArchive = (u: string): string => ARCHIVE_WRAP.exec(u)?.[1] ?? u;

const hostnameOf = (u: string): string => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Registrable domain = last two labels (single-label TLD corpus; co.uk-style
 *  multi-part TLDs are not in the audited corpus). Containment checks only —
 *  never security. */
const registrableDomain = (host: string): string => {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  return labels.length <= 2 ? labels.join(".") : labels.slice(-2).join(".");
};

export function competitorTokens(competitors: string[]): { token: string; name: string }[] {
  const out: { token: string; name: string }[] = [];
  for (const name of competitors) {
    for (const token of canonicalBrand(name)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4)) {
      out.push({ token, name });
    }
  }
  return out;
}

/** Minimal page shape the guard needs (both engine CorpusPageRow and the
 *  dossier's corpus rows satisfy it). */
export type RivalOwnerPage = { url: string; final_url?: string | null };

/** Build a host → owning-competitor lookup from the brand's competitor list and
 *  the run's own corpus redirect evidence. Returns null for unowned hosts. */
export function makeRivalOwner(
  competitors: string[],
  corpus: RivalOwnerPage[],
): (host: string) => string | null {
  const tokens = competitorTokens(competitors);
  const tokenOwner = (host: string): string | null => {
    // Check the FULL host, not just the registrable domain: a rival hosted on a
    // subdomain (firebase.google.com → registrable "google.com") escaped the
    // guard and produced a "pitch the rival's own page" fix on a live audited
    // run (2026-07-20). ≥4-char tokens keep containment conservative.
    const full = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    const rd = registrableDomain(full);
    for (const { token, name } of tokens) {
      if (rd.includes(token) || full.includes(token)) return name;
    }
    return null;
  };
  const redirectOwned = new Map<string, string>();
  for (const p of corpus) {
    const uh = hostnameOf(unwrapArchive(p.url));
    const fh = hostnameOf(unwrapArchive(p.final_url ?? p.url));
    if (!uh || !fh || uh === fh) continue;
    const owner = tokenOwner(uh);
    if (owner) redirectOwned.set(fh, owner);
  }
  return (host: string): string | null => tokenOwner(host) ?? redirectOwned.get(host) ?? null;
}
