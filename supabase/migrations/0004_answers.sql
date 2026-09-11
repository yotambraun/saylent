-- answers (raw + verdict per question x engine)
create table public.answers (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  qid text not null, qtype text not null, question text not null,
  engine text not null, ok boolean not null default false,
  raw_text text default '', citations jsonb not null default '[]',
  verdict jsonb,             -- {brand_present,mention_type,prominence,sentiment,claims,other_brands,excerpt}
  fts tsvector generated always as
    (to_tsvector('english', coalesce(question,'') || ' ' || coalesce(raw_text,''))) stored,
  created_at timestamptz not null default now()
);
create index answers_fts on public.answers using gin (fts);
create index answers_run on public.answers (run_id);
alter table public.answers enable row level security;
create policy "own answers" on public.answers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
