// Settings › Brands — edit a brand's name/domain/category/competitors. Question-
// affecting edits re-baseline (confirm). Reads via the USER session (RLS = own rows).
import { serpKeyAvailable } from "@/lib/provider-settings";
import { createClient } from "@/lib/supabase/server";
import { SettingsSection } from "../setting-row";
import { BrandsList } from "./brands-client";

export const metadata = { title: "Brands · Saylent" };

export default async function BrandsPage() {
  const supabase = await createClient();
  const { data: brands, error } = await supabase
    .from("brands")
    .select("id,name,domain,competitors,category,icp,problems,engines,question_set_version")
    .is("deleted_at", null) // soft-deleted brands (migration 0038) drop out of the editor
    .order("created_at", { ascending: true });
  // A read failure is NOT "no brands" — surface it to the error boundary.
  if (error) throw error;
  // Presence only: whether the answer surfaces can be offered. Never the key.
  const serpAvailable = await serpKeyAvailable();

  return (
    <SettingsSection title="Brands" description="What each brand is and who it competes with.">
      <BrandsList
        canPickEngines
        serpAvailable={serpAvailable}
        brands={(brands ?? []).map((b) => ({
          id: b.id,
          name: b.name,
          domain: b.domain,
          competitorsCsv: ((b.competitors as string[]) ?? []).join(", "),
          category: b.category ?? "",
          icp: b.icp ?? "",
          problemsCsv: ((b.problems as string[]) ?? []).join(", "),
          engines: (b.engines as string[] | null) ?? null,
          version: b.question_set_version ?? 1,
        }))}
      />
    </SettingsSection>
  );
}
