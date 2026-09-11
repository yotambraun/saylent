"use server";
// /app/search — FTS via SQL functions (user-scoped)
// + ILIKE over corpus titles/urls. All reads under the user's JWT (RLS).
import { createClient } from "@/lib/supabase/server";

export interface SearchResults {
  answers: { run_id: string; qid: string; engine: string; question: string; snip: string }[];
  fixes: { run_id: string; fix_id: string; title: string }[];
  sources: { run_id: string; id: string; title: string | null; url: string; final_url: string | null }[];
  // true when any of the three reads errored — the client can't throw to an
  // error boundary (search is client-driven), so it renders a distinct
  // "Search is having trouble" state instead of a false "no matches".
  failed: boolean;
}

export async function searchAll(q: string): Promise<SearchResults> {
  const query = q.trim().slice(0, 100);
  if (query.length < 2) return { answers: [], fixes: [], sources: [], failed: false };
  const supabase = await createClient();

  // ILIKE pattern for corpus; strip chars that would break the .or() filter syntax
  const like = `%${query.replace(/[,()%]/g, " ").trim()}%`;

  const [answersRes, fixesRes, hiddenRes, sourcesRes] = await Promise.all([
    supabase.rpc("search_answers", { q: query }),
    supabase.rpc("search_fixes", { q: query }),
    supabase.from("runs").select("id").not("hidden_at", "is", null),
    supabase
      .from("corpus_pages")
      .select("run_id,id,title,url,final_url")
      .or(`title.ilike.${like},url.ilike.${like}`)
      .limit(20),
  ]);

  const failed = Boolean(answersRes.error || fixesRes.error || sourcesRes.error);
  if (failed) {
    console.error("[search] read error", {
      answers: answersRes.error?.message,
      fixes: fixesRes.error?.message,
      sources: sourcesRes.error?.message,
    });
  }

  // 0038 hygiene: results from user-hidden runs never surface in search.
  const hidden = new Set((hiddenRes.data ?? []).map((r: { id: string }) => r.id));
  const visible = <T extends { run_id: string }>(rows: T[]) => rows.filter((r) => !hidden.has(r.run_id));
  return {
    answers: visible(answersRes.data ?? []),
    fixes: visible(fixesRes.data ?? []),
    sources: visible(sourcesRes.data ?? []),
    failed,
  };
}
