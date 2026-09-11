-- Lean get_dossier payload (perf audit).
-- to_jsonb() includes GENERATED STORED columns, so every dossier/brief/compare
-- load has been shipping:
--   * answers.fts + fixes.fts  — tsvectors nobody reads in the browser
--     (~45 KB gzipped at Circuit Pay scale, pure waste), and
--   * runs.question_set        — added in 0034 AFTER this RPC was authored;
--     to_jsonb(r) silently picked it up. The done path never reads it (the
--     run page comment always claimed it was omitted — now it truly is).
-- ONLY change vs 0021: the three `- 'fts'` / `- 'question_set'` strips below.
-- Signature, return type, SECURITY INVOKER (default), ordering and every other
-- field are identical — RLS still applies inside every subquery. Receipts are
-- untouched: raw_text/citations still ship exactly as before.
create or replace function public.get_dossier(p_run_id uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'run', to_jsonb(r) - 'user_id' - 'question_set',
    'brand', (
      select jsonb_build_object(
        'name', b.name, 'domain', b.domain,
        'aliases', b.aliases, 'competitors', b.competitors
      )
      from public.brands b where b.id = r.brand_id
    ),
    'answers', (
      select coalesce(jsonb_agg(to_jsonb(a) - 'user_id' - 'fts' order by a.qid), '[]'::jsonb)
      from public.answers a where a.run_id = r.id
    ),
    'corpus', (
      select coalesce(jsonb_agg(to_jsonb(c) - 'user_id'), '[]'::jsonb)
      from public.corpus_pages c where c.run_id = r.id
    ),
    'checks', (
      select coalesce(jsonb_agg(to_jsonb(d) - 'user_id'), '[]'::jsonb)
      from public.domain_checks d where d.run_id = r.id
    ),
    'fixes', (
      select coalesce(jsonb_agg(to_jsonb(f) - 'user_id' - 'fts' order by f.weight desc), '[]'::jsonb)
      from public.fixes f where f.run_id = r.id
    ),
    'previous', (
      select jsonb_build_object(
        'created_at', p.created_at, 'finished_at', p.finished_at, 'scores', p.scores
      )
      from public.runs p
      where p.brand_id = r.brand_id and p.kind = 'audit' and p.status = 'done'
        and p.profile = r.profile
        and p.created_at < r.created_at
      order by p.created_at desc limit 1
    )
  )
  from public.runs r
  where r.id = p_run_id;
$$;
