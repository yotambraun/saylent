// /app/onboarding — single card, 4 fields, reachability preflight (warn, don't
// block), submit → create brand → /api/runs → /app/run/[id]. Nothing here is
// gated: every user picks their own answer engines, and if createRun refuses (a
// throttle, the operator's spend cap) its reason is rendered verbatim.
import Link from "next/link";
import { track } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@saylent/report/ui/card";
import { OnboardingForm } from "./onboarding-form";
import { shouldShowOperatorCard } from "./operator";

export const metadata = { title: "Add your brand · Saylent" };

export default async function OnboardingPage() {
  // `role` decides the first-operator card below.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };

  // onboarding_started — the top of the activation funnel. Fire only
  // for a user who has no brands yet (the genuine "starting onboarding" state), so
  // re-visits by an already-onboarded user don't refire. track() never throws.
  // The same count decides the first-operator card below.
  let brandCount: number | null = null;
  if (user) {
    const { count } = await supabase
      .from("brands")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    brandCount = count ?? 0;
    if (brandCount === 0) await track("onboarding_started", { userId: user.id });
  }

  const showOperatorCard = shouldShowOperatorCard({ role: profile?.role, brandCount });

  return (
    <main className="flex flex-col items-center gap-4 py-12">
      {showOperatorCard && (
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="font-display text-lg">You run this deployment</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-wire">
            You are the operator of this deployment. Budget controls and the admin console are in
            the sidebar.{" "}
            <Link href="/admin" className="underline underline-offset-2">
              Open the admin console
            </Link>
            .
          </CardContent>
        </Card>
      )}
      {/* Every user picks their own answer engines — there are no plan tiers. */}
      <OnboardingForm canPickEngines />
    </main>
  );
}
