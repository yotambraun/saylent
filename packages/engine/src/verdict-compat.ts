// E2a backward-compat layer (see METHODOLOGY.md). The DB holds thousands of
// OLD-shape verdicts (`claims: string[]`, `other_brands: string[]`) alongside
// NEW-shape ones (`claims: {text,kind}[]`, `other_brands: {name,why}[]`).
// EVERY reader — score.ts, the dossier, and buildVerdict's own parse of the
// judge JSON — routes through these normalizers so both shapes are handled
// forever. src/engine/ is PURE: no Next/Supabase imports.
import type { Claim, OtherBrand } from "./types";

export const CLAIM_KINDS = ["praise", "risk", "neutral_fact"] as const;

/** Anything verdict-shaped: a typed Verdict, a loosely-typed DB jsonb row, or
 * the raw judge JSON. We only read `.claims` / `.other_brands` off it. */
type VerdictLike = { claims?: unknown; other_brands?: unknown } | null | undefined;

const field = (v: VerdictLike, key: "claims" | "other_brands"): unknown =>
  v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined;

/** Normalize `claims` from either shape. Old bare strings → kind
 * "neutral_fact"; new objects keep their kind (invalid/absent kind →
 * "neutral_fact"); empty text and junk entries are dropped. Order preserved. */
export function normClaims(v: VerdictLike): Claim[] {
  const raw = field(v, "claims");
  if (!Array.isArray(raw)) return [];
  const out: Claim[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const text = item.trim();
      if (text) out.push({ text, kind: "neutral_fact" });
    } else if (item && typeof item === "object") {
      const t = (item as Record<string, unknown>).text;
      const text = typeof t === "string" ? t.trim() : "";
      if (!text) continue;
      const k = (item as Record<string, unknown>).kind;
      const kind = (CLAIM_KINDS as readonly unknown[]).includes(k)
        ? (k as Claim["kind"])
        : "neutral_fact";
      out.push({ text, kind });
    }
  }
  return out;
}

/** Normalize `other_brands` from either shape. Old bare strings → why "";
 * new objects keep their why (non-string/absent why → ""); empty names and
 * junk entries are dropped. Order preserved. */
export function normOtherBrands(v: VerdictLike): OtherBrand[] {
  const raw = field(v, "other_brands");
  if (!Array.isArray(raw)) return [];
  const out: OtherBrand[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const name = item.trim();
      if (name) out.push({ name, why: "" });
    } else if (item && typeof item === "object") {
      const n = (item as Record<string, unknown>).name;
      const name = typeof n === "string" ? n.trim() : "";
      if (!name) continue;
      const w = (item as Record<string, unknown>).why;
      const why = typeof w === "string" ? w.trim() : "";
      out.push({ name, why });
    }
  }
  return out;
}
