// View-as (READ ONLY). Reproduce a ticket by rendering
// a customer's dossier WITHOUT minting their session. All reads go through the
// service role (createAdminClient); requireAdmin() gates it. It renders the shared
// Dossier with `demo` = true, which structurally removes every write surface
// (Mark-as-shipped, share controls) — so there is NO write path here, only a
// labeled read. Nothing on this page posts to a server action.
import { notFound } from "next/navigation";
import { Dossier } from "@saylent/report/components/dossier";
import type { RunRow } from "@saylent/report/components/run-view";
import { requireAdmin } from "@/lib/admin-auth";
import { fetchDossierViaRpc } from "@/lib/dossier-data";
import { MODELS } from "@saylent/engine/models";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "View-as (read-only) · Admin · Saylent" };

const MODELS_USED = `${MODELS.chatgptAnswer} · ${MODELS.claudeAnswer} · ${MODELS.geminiAnswer} · ${MODELS.perplexityAnswer}`;
const ENGINE_MODELS: Record<string, string> = {
  chatgpt: MODELS.chatgptAnswer,
  claude: MODELS.claudeAnswer,
  gemini: MODELS.geminiAnswer,
  perplexity: MODELS.perplexityAnswer,
};

export default async function ViewAsPage({ params }: { params: Promise<{ runId: string }> }) {
  await requireAdmin();
  const { runId } = await params;
  const admin = createAdminClient();

  const d = await fetchDossierViaRpc(admin, runId);
  if (!d || !d.brand || d.run.status !== "done" || d.run.kind !== "audit") notFound();

  // resolve the owner's email for the banner (who we're viewing as). get_dossier
  // strips user_id from its run payload, so read it from the runs row directly.
  const { data: runOwner } = await admin
    .from("runs")
    .select("user_id")
    .eq("id", runId)
    .maybeSingle();
  let ownerEmail = "unknown";
  if (runOwner?.user_id) {
    const { data: owner } = await admin
      .from("profiles")
      .select("email")
      .eq("id", runOwner.user_id)
      .maybeSingle();
    if (owner?.email) ownerEmail = owner.email;
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="sticky top-0 z-20 border-b border-pill-dismissed/50 bg-pill-dismissed/10 px-4 py-2 text-center font-mono text-xs text-pill-dismissed">
        Viewing as {ownerEmail}. READ ONLY. No changes you make here are saved.
      </div>
      <main className="px-4 py-10">
        <Dossier
          run={d.run as unknown as RunRow}
          brand={{
            name: d.brand.name,
            domain: d.brand.domain,
            aliases: d.brand.aliases as string[],
            competitors: d.brand.competitors as string[],
            authorized_at: d.brand.authorized_at,
          }}
          answers={d.answers as never}
          corpus={d.corpus as never}
          checks={d.checks as never}
          fixes={d.fixes as never}
          modelsUsed={MODELS_USED}
          engineModels={ENGINE_MODELS}
          demo
        />
      </main>
    </div>
  );
}
