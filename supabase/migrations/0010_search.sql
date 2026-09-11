-- Search: FTS over the caller's answers.fts and fixes.fts.
-- SECURITY INVOKER (default) + explicit auth.uid() filter, so a user can only
-- ever search their own rows. Headline markers are [[ ]] so the UI can render
-- highlights without injecting HTML.
create or replace function public.search_answers(q text)
returns table (run_id uuid, qid text, engine text, question text, snip text)
language sql stable
set search_path = public
as $$
  select a.run_id, a.qid, a.engine, a.question,
         ts_headline('english', a.raw_text, plainto_tsquery('english', q),
                     'StartSel=[[, StopSel=]], MaxWords=30, MinWords=10')
  from public.answers a
  where a.user_id = auth.uid()
    and a.fts @@ plainto_tsquery('english', q)
  limit 20;
$$;

create or replace function public.search_fixes(q text)
returns table (run_id uuid, fix_id uuid, title text)
language sql stable
set search_path = public
as $$
  select f.run_id, f.id, f.title
  from public.fixes f
  where f.user_id = auth.uid()
    and f.fts @@ plainto_tsquery('english', q)
  limit 20;
$$;
