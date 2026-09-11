"use server";
// The write half of the Questions
// and run options tab. Three mutations, one shared persist:
//   saveRunOptions        save the draft, spend nothing
//   startRunWithOptions   save the draft, then start the audit through createRun
//   resetRunOptions       throw the draft away and go back to the generated set
//
// Everything runs on the OWNER'S session (RLS: own rows only) and every one of
// them opens with assertNotDemo, so a read-only demo visitor can neither store a
// draft nor reach a run-creation path.
//
// THE RE-BASELINE RULE (the honest part). A brand's frozen question_set is what
// a verify re-asks; two runs that asked different questions are not comparable.
// So the moment a saved draft would ask a different set — different questions,
// or a different answer-engine subset — this clears question_set and bumps
// question_set_version, exactly as a question-affecting brand edit already does
// (settings/actions.ts updateBrand, migration 0029 header). The next audit
// re-freezes questions and engines together and becomes the new baseline.
import { revalidatePath } from "next/cache";
import { engineSetChanged, frozenEngines, resolveEngines } from "@saylent/engine/engines";
import type { Question } from "@saylent/engine/types";
import { assertNotDemo } from "@/lib/demo-mode";
import {
  type DraftQuestion,
  normalizeRunOptions,
  questionsChanged,
  type RunOptions,
  type RunSkipOptions,
} from "@/lib/question-options";
import { createRun } from "@/lib/runs";
import { createClient } from "@/lib/supabase/server";
import { baselineDraft } from "./baseline";

/** Exactly what the form holds. Rows arrive unvalidated — normalizeRunOptions is
 *  the authority, never the client. */
export interface RunOptionsForm {
  brandId: string;
  questions: DraftQuestion[];
  samples: number;
  engines: string[];
  locale: string;
  skip: RunSkipOptions;
}

export type SaveResult =
  | { ok: true; rebaselined: boolean }
  | { ok: false; error: string };

export type StartResult =
  | { ok: true; runId: string }
  | { ok: false; error: string };

type BrandRow = {
  id: string;
  name: string;
  category: string | null;
  icp: string | null;
  competitors: string[] | null;
  problems: string[] | null;
  engines: string[] | null;
  question_set: { questions?: Question[]; engines?: string[] } | null;
  question_set_version: number | null;
};

const BRAND_COLUMNS =
  "id,name,category,icp,competitors,problems,engines,question_set,question_set_version";

/** Validate the form, store it on the brand, re-baseline when the run would ask a
 *  different set. Shared by save and save-then-run so the two can never drift. */
async function persist(
  input: RunOptionsForm,
): Promise<{ ok: false; error: string } | { ok: true; userId: string; options: RunOptions; rebaselined: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  // RLS already scopes this to the caller's own brands; the explicit user_id
  // filter is the second lock, so an id from another account reads as missing
  // rather than as a row somebody else owns.
  const { data, error: readError } = await supabase
    .from("brands")
    .select(BRAND_COLUMNS)
    .eq("id", input.brandId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!data) return { ok: false, error: "Brand not found." };
  const brand = data as unknown as BrandRow;

  const normalized = normalizeRunOptions({
    questions: input.questions,
    samples: input.samples,
    engines: input.engines,
    locale: input.locale,
    skip: input.skip,
  });
  if (!normalized.ok) return { ok: false, error: normalized.error };
  const options = normalized.value;

  // An unchanged set is stored as NO set: the pipeline then regenerates (or
  // reuses the frozen envelope) exactly as it does today, and a locale still
  // has something to translate.
  const baseline = baselineDraft(brand, new Date().getFullYear());
  const editedQuestions = questionsChanged(baseline, options.questions ?? []);
  if (!editedQuestions) delete options.questions;

  // An engine change is a question change, methodologically: a verify may not
  // compare a four-engine baseline against a two-engine re-run.
  const enginesNow = frozenEngines(brand.question_set, brand.engines);
  const enginesNext = resolveEngines(options.engines ?? brand.engines);
  const enginesEdited = engineSetChanged(enginesNow, enginesNext);

  const hasFrozenSet = !!brand.question_set?.questions?.length;
  const rebaselined = hasFrozenSet && (editedQuestions || enginesEdited);

  const { error } = await supabase
    .from("brands")
    .update({
      run_options: options,
      ...(rebaselined
        ? { question_set: null, question_set_version: (brand.question_set_version ?? 1) + 1 }
        : {}),
    })
    .eq("id", brand.id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  return { ok: true, userId: user.id, options, rebaselined };
}

/** Save the draft. Spends nothing, starts nothing. */
export async function saveRunOptions(input: RunOptionsForm): Promise<SaveResult> {
  const demo = assertNotDemo();
  if (demo) return demo;
  const saved = await persist(input);
  if (!saved.ok) return saved;
  revalidatePath(`/app/brand/${input.brandId}/questions`);
  revalidatePath("/app");
  return { ok: true, rebaselined: saved.rebaselined };
}

/** Save the draft and start the audit. createRun stays THE one run-creation path
 *  — every guard it owns (demo, kill switch, spend ceiling, one active run per
 *  brand, the throttle) still applies, unchanged. */
export async function startRunWithOptions(input: RunOptionsForm): Promise<StartResult> {
  const demo = assertNotDemo();
  if (demo) return demo;
  const saved = await persist(input);
  if (!saved.ok) return saved;

  const run = await createRun({
    userId: saved.userId,
    brandId: input.brandId,
    kind: "audit",
    runOptions: saved.options,
  });
  if (!run.ok) return { ok: false, error: run.reason };

  revalidatePath(`/app/brand/${input.brandId}/questions`);
  revalidatePath("/app");
  return { ok: true, runId: run.runId };
}

/** Drop the draft. The brand goes back to the generated set and every default;
 *  no re-baseline, because clearing a draft cannot change what a frozen set asks. */
export async function resetRunOptions(brandId: string): Promise<SaveResult> {
  const demo = assertNotDemo();
  if (demo) return demo;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { error } = await supabase
    .from("brands")
    .update({ run_options: null })
    .eq("id", brandId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/app/brand/${brandId}/questions`);
  return { ok: true, rebaselined: false };
}
