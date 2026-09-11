"use server";
// "Confirm your audit" — persist the buyer's confirm-page edits before
// the run is spent. Mirrors the settings updateBrand pattern (RLS: own rows only,
// same zod bounds) but scoped to the pre-first-audit confirm flow: it only edits
// competitors / category / icp, never name / domain, and never touches a set that
// is already frozen (the page runs this ONLY for brands without one — the frozen
// guard here is belt-and-braces).
import { revalidatePath } from "next/cache";
import { parseIcp } from "@/app/app/settings/brands/brand-context";
import { assertNotDemo } from "@/lib/demo-mode";
import { createClient } from "@/lib/supabase/server";
import { categorySchema, parseCompetitors } from "@saylent/report/validation";

export async function saveConfirmEdits(input: {
  brandId: string;
  category: string;
  competitorsCsv: string;
  icp: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // Hosted read-only demo — refuse every write.
  const demo = assertNotDemo();
  if (demo) return demo;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  // RLS-scoped ownership check; question_set tells us whether the set is frozen.
  const { data: brand } = await supabase
    .from("brands")
    .select("id,question_set")
    .eq("id", input.brandId)
    .maybeSingle();
  if (!brand) return { ok: false, error: "Brand not found." };

  // Already frozen → editing fields can't change the frozen questions (that needs a
  // re-baseline in settings). Accept as a no-op so "Start my audit" still proceeds.
  const frozen = (brand.question_set as { questions?: unknown[] } | null)?.questions?.length;
  if (frozen) return { ok: true };

  // Same caps as createBrand / updateBrand.
  const category = categorySchema.safeParse(input.category ?? "");
  if (!category.success) return { ok: false, error: category.error.issues[0].message };
  const competitors = parseCompetitors(input.competitorsCsv ?? "");
  if (!competitors.ok) return { ok: false, error: competitors.error };
  const icp = parseIcp(input.icp ?? "");
  if (!icp.ok) return { ok: false, error: icp.error };

  // context_source='user' only when the buyer actually set an icp — an endorsed,
  // non-empty icp then wins VERBATIM in the audit (functions.ts keepIcp). Left blank,
  // context_source stays null so the audit derives icp from the crawled site.
  const { error } = await supabase
    .from("brands")
    .update({
      category: category.data,
      competitors: competitors.list,
      icp: icp.value,
      ...(icp.value ? { context_source: "user" } : {}),
    })
    .eq("id", input.brandId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  revalidatePath("/app/settings/brands");
  return { ok: true };
}
