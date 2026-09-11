-- Cost honesty: persist exact provider usage (tokens + search calls) per
-- answer, so run costs are recorded, not estimated.
alter table public.answers add column if not exists usage jsonb;
