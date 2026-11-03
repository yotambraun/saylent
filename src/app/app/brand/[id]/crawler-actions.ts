"use server";
// Delete one stored crawler report (migration 0046 grants the owner delete on
// their own rows; RLS makes a foreign id a no-op).
import { revalidatePath } from "next/cache";
import { assertNotDemo } from "@/lib/demo-mode";
import { createClient } from "@/lib/supabase/server";

export async function deleteCrawlerReport(brandId: string, reportId: string): Promise<{ ok: boolean; error?: string }> {
  const demo = assertNotDemo();
  if (demo) return { ok: false, error: demo.error };
  const supabase = await createClient();
  const { error } = await supabase.from("crawler_reports").delete().eq("id", reportId).eq("brand_id", brandId);
  if (error) return { ok: false, error: "Could not delete the report." };
  revalidatePath(`/app/brand/${brandId}`);
  return { ok: true };
}
