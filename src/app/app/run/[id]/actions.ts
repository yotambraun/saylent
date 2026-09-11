"use server";
// "Mark as shipped" sets fixes.published_at.
// Runs under the USER's session (RLS: own rows only) — no service role here.
import { revalidatePath } from "next/cache";
import { track } from "@/lib/analytics";
import { assertNotDemo } from "@/lib/demo-mode";
import { createClient } from "@/lib/supabase/server";

export async function markFixShipped(fixId: string, runId: string, alsoRevalidate?: string) {
  // Hosted read-only demo — refuse every write.
  const demo = assertNotDemo();
  if (demo) return demo;

  const supabase = await createClient();
  const { error } = await supabase
    .from("fixes")
    .update({ published_at: new Date().toISOString() })
    .eq("id", fixId);
  if (error) return { ok: false as const, error: error.message };
  // fix_shipped analytics event — a fix transitioned to shipped (published_at set). This
  // is the single source of truth for shipping (dossier + /app/fixes both call it).
  // Fire-and-forget: an auth/tracking blip must never break the user's action.
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) await track("fix_shipped", { userId: user.id, props: { fix_id: fixId, run_id: runId } });
  } catch {
    // analytics is best-effort — never let it fail the ship action
  }
  revalidatePath(`/app/run/${runId}`);
  if (alsoRevalidate) revalidatePath(alsoRevalidate);
  return { ok: true as const };
}

// ---- Data hygiene (migration 0038) ---------------------------------
// All three run through the USER's session client, so RLS ("own runs") is the ownership
// gate — a foreign run id is invisible and the UPDATE matches zero rows. Server actions
// so no run id or token is ever trusted from the client beyond the id being acted on.

/** Revalidate the surfaces a hidden/cancelled run appears on. brandId is looked up
 *  server-side (never trusted from the client) so the brand Movement list refreshes. */
async function revalidateRunSurfaces(
  supabase: Awaited<ReturnType<typeof createClient>>,
  runId: string,
) {
  const { data } = await supabase.from("runs").select("brand_id").eq("id", runId).maybeSingle();
  revalidatePath(`/app/run/${runId}`);
  revalidatePath("/app");
  revalidatePath("/app/fixes");
  if (data?.brand_id) revalidatePath(`/app/brand/${data.brand_id}`);
}

/** Hide a run from every dashboard/list/cohort; it stays reachable by direct URL. */
export async function hideRun(runId: string): Promise<{ ok: boolean; error?: string }> {
  // Hosted read-only demo — refuse every write.
  const demo = assertNotDemo();
  if (demo) return demo;

  const supabase = await createClient();
  const { error } = await supabase
    .from("runs")
    .update({ hidden_at: new Date().toISOString() })
    .eq("id", runId)
    .is("hidden_at", null);
  if (error) return { ok: false, error: error.message };
  await revalidateRunSurfaces(supabase, runId);
  return { ok: true };
}

/** Bring a hidden run back into lists. */
export async function unhideRun(runId: string): Promise<{ ok: boolean; error?: string }> {
  // Hosted read-only demo — refuse every write.
  const demo = assertNotDemo();
  if (demo) return demo;

  const supabase = await createClient();
  const { error } = await supabase
    .from("runs")
    .update({ hidden_at: null })
    .eq("id", runId)
    .not("hidden_at", "is", null);
  if (error) return { ok: false, error: error.message };
  await revalidateRunSurfaces(supabase, runId);
  return { ok: true };
}

/** Cancel a still-pending run: mark it failed with an honest note, ONLY while it is
 *  queued/running (a done/failed run is left untouched). The `.in("status", …)` guard
 *  makes the transition atomic under RLS.
 *
 *  NOTE (HANDOFF): the Inngest pipeline does NOT yet re-check status between steps and
 *  db.ts setStage unconditionally writes status:"running", so a cancel can be clobbered
 *  back to running and in-flight LLM steps keep spending. The honest copy reflects that
 *  this stops the run on our side and future stages should no-op — see the report. */
export async function cancelRun(runId: string): Promise<{ ok: boolean; error?: string }> {
  // Hosted read-only demo — refuse every write.
  const demo = assertNotDemo();
  if (demo) return demo;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("runs")
    .update({ status: "failed", error: "cancelled by you", finished_at: new Date().toISOString() })
    .eq("id", runId)
    .in("status", ["queued", "running"])
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "This run already finished. Nothing to cancel." };
  await revalidateRunSurfaces(supabase, runId);
  return { ok: true };
}
