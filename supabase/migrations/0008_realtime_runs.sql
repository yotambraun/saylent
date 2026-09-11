-- Enable Realtime replication for runs (live progress UI).
-- SQL equivalent of Dashboard → Database → Replication → enable for runs.
alter publication supabase_realtime add table public.runs;
