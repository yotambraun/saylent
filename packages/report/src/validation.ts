// zod bounds on brand + profile inputs.
// These fields flow into LLM prompts and storage, so unbounded input is a cost +
// storage amplification vector. Pure (no Supabase/Next) so it's importable by
// server actions and pinnable by vitest. Messages are user-facing (rendered
// verbatim, same as the entitlement reasons).
import { z } from "zod";

// A host label: 1–63 chars, alphanumeric with internal hyphens; at least two
// dot-separated labels ending in a 2+ letter TLD. Accepts punycode IDNs (xn--…).
const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

// SUBPATH HOSTING: a brand site may live under a path —
// a docs subpath, a GitHub-Pages project site (`yotambraun.github.io/saylent`).
// The engine already audits those (`parseSiteRoot` in packages/engine/src/crawl.ts:
// crawl stays inside the prefix, robots.txt is read from the host root), so the
// form must stop throwing the path away. A path is optional: with none, everything
// below behaves exactly as it did (bare host, lowercased).
// Segments are conservative — unreserved URL characters only, no dot segments.
const SITE_PATH_RE = /^(\/[A-Za-z0-9._~%!$&'()*+,;=:@-]+)*$/;
export const MAX_SITE_PATH = 120;

export const MAX_COMPETITORS = 10;

export const brandNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a brand name.")
  .max(120, "Brand name is too long (120 characters max).");

export const domainSchema = z
  .string()
  .trim()
  .min(1, "Enter a domain.")
  .max(253, "Domain is too long (253 characters max).")
  .refine((h) => HOST_RE.test(h), "Enter a valid domain, e.g. example.com.");

/** Split a user-typed brand site into its host and its optional path prefix.
 *  Strips the scheme, any query/fragment and a trailing slash; lowercases the
 *  HOST only (paths are case-sensitive). A bare domain returns path "". */
export function splitSiteRoot(input: string): { host: string; path: string } {
  const raw = String(input ?? "")
    .trim()
    .replace(/^https?:\/\//i, "");
  const noQuery = raw.split(/[?#]/)[0];
  const slash = noQuery.indexOf("/");
  const host = (slash === -1 ? noQuery : noQuery.slice(0, slash)).toLowerCase();
  const path = slash === -1 ? "" : noQuery.slice(slash).replace(/\/+$/, "");
  return { host, path };
}

/** Validate a brand site root — `acme.com` or `acme.com/docs` (a full
 *  `https://acme.com/docs/` is accepted and normalized). Returns the stored form:
 *  the lowercased host, plus the path when there is one. */
export function validateSiteRoot(
  input: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const { host, path } = splitSiteRoot(input);
  const domain = domainSchema.safeParse(host);
  if (!domain.success) return { ok: false, error: domain.error.issues[0].message };
  if (path) {
    if (path.length > MAX_SITE_PATH) {
      return { ok: false, error: `Site path is too long (${MAX_SITE_PATH} characters max).` };
    }
    if (!SITE_PATH_RE.test(path) || /(^|\/)\.\.?(\/|$)/.test(path)) {
      return { ok: false, error: "Enter a valid site address, e.g. example.com or example.com/docs." };
    }
  }
  return { ok: true, value: `${domain.data}${path}` };
}

export const categorySchema = z
  .string()
  .trim()
  .max(120, "Category is too long (120 characters max).");

export const displayNameSchema = z
  .string()
  .trim()
  .max(80, "Display name is too long (80 characters max).");

// Validate a user-supplied IANA time zone before it
// is written to profiles.timezone. Intl.DateTimeFormat throws a RangeError for an
// unknown zone, so a try/catch is the runtime's own tz-database check (more
// authoritative than a static allow-list). Empty is handled by the caller (clears
// the column → UTC fallback). Pure + no deps → unit-testable.
export function isValidTimeZone(tz: string): boolean {
  const trimmed = typeof tz === "string" ? tz.trim() : "";
  if (!trimmed) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

const competitorsCsvSchema = z
  .string()
  .max(500, "Competitor list is too long (500 characters max).");

/** Parse the comma-separated competitor string with a length + count cap. */
export function parseCompetitors(
  csv: string,
): { ok: true; list: string[] } | { ok: false; error: string } {
  const bounded = competitorsCsvSchema.safeParse(csv ?? "");
  if (!bounded.success) return { ok: false, error: bounded.error.issues[0].message };
  const list = csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length > MAX_COMPETITORS) {
    return { ok: false, error: `Up to ${MAX_COMPETITORS} competitors.` };
  }
  return { ok: true, list };
}

export type ValidBrandFields = {
  name: string;
  domain: string;
  category: string;
  competitors: string[];
};

/** Validate + normalize the brand form fields once, shared by createBrand and
 *  updateBrand. Strips the protocol (and any query/fragment) from the domain and
 *  keeps an optional path prefix — `acme.com` and `acme.com/docs` are both valid
 *  site roots (see validateSiteRoot). */
export function validateBrandFields(input: {
  name: string;
  domain: string;
  category?: string;
  competitorsCsv?: string;
}): { ok: true; value: ValidBrandFields } | { ok: false; error: string } {
  const name = brandNameSchema.safeParse(input.name);
  if (!name.success) return { ok: false, error: name.error.issues[0].message };

  const domain = validateSiteRoot(input.domain);
  if (!domain.ok) return { ok: false, error: domain.error };

  const category = categorySchema.safeParse(input.category ?? "");
  if (!category.success) return { ok: false, error: category.error.issues[0].message };

  const competitors = parseCompetitors(input.competitorsCsv ?? "");
  if (!competitors.ok) return { ok: false, error: competitors.error };

  return {
    ok: true,
    value: {
      name: name.data,
      domain: domain.value,
      category: category.data,
      competitors: competitors.list,
    },
  };
}
