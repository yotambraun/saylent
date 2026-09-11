// /app/search — redesigned after a UX critique: personalized
// suggestion chips (the user's real competitors), result rows labeled with
// brand + run date, explanatory empty states. FTS mechanics unchanged.
import { createClient } from "@/lib/supabase/server";
import { SearchClient } from "./search-client";

export const metadata = { title: "Search · Saylent" };

export default async function SearchPage() {
  const supabase = await createClient();
  const [{ data: brands }, { data: runs }] = await Promise.all([
    supabase.from("brands").select("id,name,competitors").is("deleted_at", null),
    supabase.from("runs").select("id,brand_id,created_at").is("hidden_at", null),
  ]);

  const brandName = new Map((brands ?? []).map((b) => [b.id, b.name]));
  const runMeta: Record<string, { brand: string; date: string; brandId: string; iso: string }> = {};
  for (const r of runs ?? []) {
    runMeta[r.id] = {
      brand: brandName.get(r.brand_id) ?? "",
      date: new Date(r.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      brandId: r.brand_id,
      iso: r.created_at,
    };
  }

  // brand facet: the user's brands (only meaningful with >1); chip filters rows
  const brandList = (brands ?? []).map((b) => ({ id: b.id, name: b.name }));

  // personalized chips: the user's actual competitors + universally useful topics
  const competitors = [...new Set((brands ?? []).flatMap((b) => (b.competitors as string[]) ?? []))]
    .filter(Boolean)
    .slice(0, 6);
  const suggestions = [...competitors, "pricing", "robots.txt", "schema"];

  return <SearchClient runMeta={runMeta} suggestions={suggestions} brands={brandList} />;
}
