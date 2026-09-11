"use server";
// /app/settings — brand edit (question-affecting changes clear
// the frozen set + bump version = visible re-baseline).
// All updates via the USER's session (RLS: own rows only).
// (profile/email/notifications now live in /app/settings/* section pages.)
import { revalidatePath } from "next/cache";
import { engineSetChanged, normalizeSelection } from "@saylent/engine/engines";
import { assertNotDemo } from "@/lib/demo-mode";
import { createClient } from "@/lib/supabase/server";
import { validateBrandFields } from "@saylent/report/validation";
import { parseIcp, parseProblems } from "./brands/brand-context";

export async function updateBrand(input: {
  brandId: string;
  name: string;
  domain: string;
  competitorsCsv: string;
  category: string;
  /** TODO: surface brands.icp/problems as editable context — the buyer-context
   *  fields the audit derives (icp) and the questions/fixes read. Editing them
   *  corrects the stored context; not question-affecting (a fresh audit re-derives
   *  them), so they never force a re-baseline. */
  icp?: string;
  problemsCsv?: string;
  /** ENGINE-SELECT: the Pro-only answer-engine selection. Changing it is treated
   *  EXACTLY like changing the questions — it re-baselines. Undefined leaves the
   *  stored selection untouched (non-engine edits don't clear it). */
  engines?: string[];
  confirmedRebaseline: boolean;
}): Promise<{ ok: boolean; needsConfirm?: boolean; error?: string }> {
  // Hosted read-only demo — refuse every write.
  const demo = assertNotDemo();
  if (demo) return demo;

  const supabase = await createClient();
  const { data: brand } = await supabase
    .from("brands")
    .select("id,name,domain,competitors,category,engines,question_set_version")
    .eq("id", input.brandId)
    .maybeSingle();
  if (!brand) return { ok: false, error: "Brand not found." };

  // zod bounds — same caps as createBrand.
  const valid = validateBrandFields(input);
  if (!valid.ok) return { ok: false, error: valid.error };
  const { name, domain, category, competitors } = valid.value;

  // Buyer-context fields — bounded, always persisted via the owner's own RLS update.
  // Only editing them (icp/problems) does NOT re-baseline: they feed the brand model,
  // but a fresh audit re-derives them, so they never change the frozen question set.
  const icpValid = parseIcp(input.icp ?? "");
  if (!icpValid.ok) return { ok: false, error: icpValid.error };
  const problemsValid = parseProblems(input.problemsCsv ?? "");
  if (!problemsValid.ok) return { ok: false, error: problemsValid.error };

  // Resolve the new answer-engine selection (a below-floor pick errors).
  // `undefined` engines means "not editing engines" — keep the stored value and
  // don't let it force a re-baseline.
  const editingEngines = input.engines !== undefined;
  const engineSel = editingEngines
    ? normalizeSelection(input.engines)
    : ({ ok: true, store: (brand.engines as string[] | null) ?? null } as const);
  if (!engineSel.ok) return { ok: false, error: engineSel.error };

  const enginesChanged =
    editingEngines && engineSetChanged(brand.engines as string[] | null, engineSel.store);

  // A changed engine set re-baselines EXACTLY like a changed question set (frozen-set
  // methodology): clear the frozen envelope + bump the version so the next
  // audit re-freezes questions AND engines together, and no verify can compare across sets.
  const affectsQuestions =
    brand.name !== name ||
    brand.domain !== domain ||
    JSON.stringify(brand.competitors ?? []) !== JSON.stringify(competitors) ||
    (brand.category ?? "") !== category ||
    enginesChanged;

  if (affectsQuestions && !input.confirmedRebaseline) {
    return { ok: false, needsConfirm: true };
  }

  const { error } = await supabase
    .from("brands")
    .update({
      name,
      domain,
      competitors,
      category,
      icp: icpValid.value,
      problems: problemsValid.list,
      context_source: "user", // migration 0031 — owner endorses this buyer context; the audit keeps it until cleared

      ...(editingEngines ? { engines: engineSel.store } : {}),
      ...(affectsQuestions
        ? { question_set: null, question_set_version: (brand.question_set_version ?? 1) + 1 }
        : {}),
    })
    .eq("id", input.brandId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/settings/brands");
  revalidatePath("/app");
  return { ok: true };
}

/**
 * Soft-delete a brand (migration 0038). Hides the brand
 * AND all of its runs from the account — dashboard, search, fix tracker, Movement — while
 * retaining the data per the privacy policy (full account deletion lives in Settings →
 * Account). Runs under the USER's session client so RLS ("own brands"/"own runs") is the
 * ownership gate. The typed-name confirmation is re-checked server-side (defense in depth).
 *
 * Cascading hidden_at onto the brand's runs means every run-list that already filters
 * `hidden_at is null` also drops this brand's runs — one filter, enforced everywhere.
 */
export async function deleteBrand(input: {
  brandId: string;
  confirmName: string;
}): Promise<{ ok: boolean; error?: string }> {
  // Hosted read-only demo — refuse every write.
  const demo = assertNotDemo();
  if (demo) return demo;

  const supabase = await createClient();
  const { data: brand } = await supabase
    .from("brands")
    .select("id,name")
    .eq("id", input.brandId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!brand) return { ok: false, error: "Brand not found." };
  if (input.confirmName.trim().toLowerCase() !== brand.name.trim().toLowerCase()) {
    return { ok: false, error: "The name you typed doesn't match. Nothing was deleted." };
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("brands")
    .update({ deleted_at: now })
    .eq("id", input.brandId);
  if (error) return { ok: false, error: error.message };
  // Cascade: hide every one of the brand's runs so run-lists exclude them too.
  await supabase
    .from("runs")
    .update({ hidden_at: now })
    .eq("brand_id", input.brandId)
    .is("hidden_at", null);

  revalidatePath("/app/settings/brands");
  revalidatePath("/app");
  revalidatePath("/app/fixes");
  revalidatePath("/app/search");
  return { ok: true };
}
