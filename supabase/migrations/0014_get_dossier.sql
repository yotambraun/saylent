-- One-round-trip dossier: report loads were slow (measured 373ms/RTT from
-- dev — 2 sequential batches halved to 1).
-- SECURITY INVOKER (default): RLS applies inside every subquery, same
-- pattern as the 0010 search functions. Returns null when the run is
-- invisible to the caller.
create or replace function public.get_dossier(p_run_id uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'run', to_jsonb(r) - 'user_id',
    'brand', (
      select jsonb_build_object(
        'name', b.name, 'domain', b.domain,
        'aliases', b.aliases, 'competitors', b.competitors
      )
      from public.brands b where b.id = r.brand_id
    ),
    'answers', (
      select coalesce(jsonb_agg(to_jsonb(a) - 'user_id' order by a.qid), '[]'::jsonb)
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
      select coalesce(jsonb_agg(to_jsonb(f) - 'user_id' order by f.weight desc), '[]'::jsonb)
      from public.fixes f where f.run_id = r.id
    ),
    'previous', (
      select jsonb_build_object(
        'created_at', p.created_at, 'finished_at', p.finished_at, 'scores', p.scores
      )
      from public.runs p
      where p.brand_id = r.brand_id and p.kind = 'audit' and p.status = 'done'
        and p.created_at < r.created_at
      order by p.created_at desc limit 1
    )
  )
  from public.runs r
  where r.id = p_run_id;
$$;
