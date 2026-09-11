-- corpus_pages (the battlefield)
create table public.corpus_pages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  url text not null, final_url text, title text, page_type text,
  cited_by jsonb not null default '{}', cited_for_qids text[] default '{}',
  fetch_status int, brand_present boolean, brand_context text,
  competitors_present text[] default '{}', opportunity boolean default false
);
create index corpus_run on public.corpus_pages (run_id);
alter table public.corpus_pages enable row level security;
create policy "own corpus" on public.corpus_pages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
