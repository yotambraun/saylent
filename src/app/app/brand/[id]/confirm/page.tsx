// "Confirm your audit" — the #1 'glad I ran it' gap: the audit ran
// BLIND while the 23-question set froze unseen. This page shows the EXACT questions
// the audit will freeze (deterministic, no LLM), lets them fix a typo'd competitor /
// vague category / missing icp, then starts the run. Reached from onboarding (after
// brand creation) and from the dashboard "Run your audit" CTA for a brand that has
// no frozen set yet. Brands WITH a frozen set never land here (nothing to aim).
//
// THE PRICE IS ON THIS PAGE. This is the screen that carries
// "Start my audit" — the button that actually spends the operator's provider
// credit — and it used to show no number at all: the estimate lived only on
// /app/brand/[id]/questions, which the onboarding path never routes through. The
// same estimate now sits directly above the button, with the same arithmetic
// (src/lib/question-options.ts, shared with the CLI preflight) plus what is left
// of today's deployment-wide spend cap.
import { notFound } from "next/navigation";
import { ALL_ENGINES, frozenEngines } from "@saylent/engine/engines";
import { PROFILES } from "@saylent/engine/profiles";
import { budgetToday, resolveRunProfile } from "@/lib/runs";
import { createClient } from "@/lib/supabase/server";
import { ConfirmClient } from "./confirm-client";
import type { Question } from "@saylent/engine/types";

export const metadata = { title: "Confirm your audit · Saylent" };

export default async function ConfirmAuditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // RLS scopes this to the owner's own brand. maybeSingle + split: a genuine
  // missing brand is a 404; a DB error reaches the error boundary (error.tsx).
  const { data: brand, error } = await supabase
    .from("brands")
    .select("id,name,domain,category,competitors,icp,problems,engines,question_set")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!brand) notFound();

  const frozenSet = brand.question_set as { questions?: Question[] } | null;
  const frozenQuestions = frozenSet?.questions?.length ? frozenSet.questions : null;

  // The template-set version stamps {year} into the category questions. Fix it on
  // the server so the client's live re-fill is hydration-stable and matches the set
  // the pipeline will generate in this same window.
  const year = new Date().getFullYear();

  // The estimate's fixed inputs: the profile this deployment's audits run at
  // (which sets the default sample count and how many fix drafts are paid for),
  // the engines this brand asks, and today's budget position.
  const profile = resolveRunProfile({
    wantsSmoke: process.env.AUDIT_PROFILE === "smoke",
    isProduction: process.env.VERCEL_ENV === "production",
  });
  const budget = await budgetToday();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-10">
      <ConfirmClient
        brandId={brand.id}
        brandName={brand.name}
        domain={brand.domain}
        initialCategory={brand.category ?? ""}
        initialCompetitors={(brand.competitors as string[] | null) ?? []}
        initialIcp={brand.icp ?? ""}
        problems={(brand.problems as string[] | null) ?? []}
        year={year}
        frozenQuestions={frozenQuestions}
        profile={profile}
        samples={PROFILES[profile].scoredSamples}
        engines={frozenEngines(
          brand.question_set as { engines?: string[] } | null,
          (brand.engines as string[] | null) ?? null,
        )}
        allEngineCount={ALL_ENGINES.length}
        capUsd={budget.capUsd}
        capRemainingUsd={budget.remainingUsd}
      />
    </main>
  );
}
