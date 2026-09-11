-- brands
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null, domain text not null,
  aliases text[] not null default '{}', category text default '',
  icp text default '', competitors text[] not null default '{}',
  problems text[] not null default '{}',
  question_set jsonb,          -- frozen set [{qid,text,qtype}] + version
  question_set_version int not null default 1,
  created_at timestamptz not null default now()
);
alter table public.brands enable row level security;
create policy "own brands" on public.brands
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
