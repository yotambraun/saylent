-- domain_checks + fixes
create table public.domain_checks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  check_name text, status text, detail text, factor text
);
alter table public.domain_checks enable row level security;
create policy "own checks" on public.domain_checks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.fixes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  fix_key text, title text, factor text, weight numeric, effort text,
  time_to_impact text, engines text[], evidence jsonb, artifact text,
  published_at timestamptz,        -- user marks "I shipped this"
  fts tsvector generated always as
    (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(artifact,''))) stored
);
create index fixes_fts on public.fixes using gin (fts);
alter table public.fixes enable row level security;
create policy "own fixes" on public.fixes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
