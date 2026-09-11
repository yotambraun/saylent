-- runs (an audit or a verify)
-- NOTE after applying: Dashboard → Database → Replication → enable for runs (Realtime progress)
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'audit',           -- audit|verify
  baseline_run_id uuid references public.runs(id),
  status text not null default 'queued',        -- queued|running|done|failed
  profile text not null default 'full',         -- full|smoke (smoke = dev-only cheap run)
  stage text not null default '',               -- live progress label
  scores jsonb, est_cost_usd numeric, error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.runs enable row level security;
create policy "own runs" on public.runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
