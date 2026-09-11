import "server-only";
// /demo — fetches ONLY the run whose id equals env DEMO_RUN_ID via
// service role. Never accepts an id parameter; refuses runs with profile≠'full'.
// Returns null ⇒ the page falls back to the scripted sample.
import { createAdminClient } from "@/lib/supabase/admin";

export async function getDemoRun() {
  const id = process.env.DEMO_RUN_ID?.trim();
  if (!id) return null;
  const admin = createAdminClient();

  const { data: run } = await admin
    .from("runs")
    .select("id,kind,status,stage,profile,scores,est_cost_usd,error,created_at,finished_at,brand_id")
    .eq("id", id)
    .eq("status", "done")
    .maybeSingle();
  if (!run || run.profile !== "full") return null; // showcase must be a FULL run

  const [{ data: brand }, { data: answers }, { data: corpus }, { data: checks }, { data: fixes }] =
    await Promise.all([
      admin.from("brands").select("name,domain,aliases,competitors").eq("id", run.brand_id).single(),
      admin
        .from("answers")
        .select("id,qid,qtype,question,engine,ok,raw_text,citations,verdict,error")
        .eq("run_id", id)
        .order("qid"),
      admin
        .from("corpus_pages")
        .select(
          "id,url,final_url,title,page_type,cited_by,cited_for_qids,fetch_status,brand_present,brand_context,competitors_present,opportunity",
        )
        .eq("run_id", id),
      admin.from("domain_checks").select("id,check_name,status,detail,factor").eq("run_id", id),
      admin
        .from("fixes")
        .select("id,fix_key,title,factor,weight,effort,time_to_impact,engines,evidence,artifact,published_at")
        .eq("run_id", id)
        .order("weight", { ascending: false }),
    ]);

  if (!brand) return null;
  return { run, brand, answers: answers ?? [], corpus: corpus ?? [], checks: checks ?? [], fixes: fixes ?? [] };
}
