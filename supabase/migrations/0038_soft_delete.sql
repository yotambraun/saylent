-- 0038 — data hygiene: let owners HIDE a run and
-- SOFT-DELETE a brand, so the $79 deliverable's account stays tidy without hard
-- deletes (data is retained per the privacy policy; full account deletion lives in
-- Settings → Account). Additive + nullable, so every existing read is unaffected.
--
-- RLS note: public.runs and public.brands each already carry a `for all` owner policy
-- (`using (auth.uid() = user_id) with check (auth.uid() = user_id)`, migrations 0002/0003),
-- so an owner can already UPDATE these new columns through their own session client —
-- no new policy is required. Server actions write with the user's client so RLS enforces
-- ownership; a foreign row is invisible and the UPDATE matches zero rows.
alter table public.runs add column if not exists hidden_at timestamptz;
alter table public.brands add column if not exists deleted_at timestamptz;

-- The universal filter is "… is null" (exclude hidden runs / deleted brands). Partial
-- indexes keep those list queries cheap as accounts grow, matching the common order-by.
create index if not exists runs_visible_idx on public.runs (brand_id, created_at) where hidden_at is null;
create index if not exists brands_visible_idx on public.brands (user_id, created_at) where deleted_at is null;
