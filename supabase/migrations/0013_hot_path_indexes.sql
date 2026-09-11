-- Performance audit: Postgres does NOT auto-index FKs; these cover every
-- hot read path.
-- Dossier sections: checks + fixes by run
create index if not exists checks_run on public.domain_checks (run_id);
create index if not exists fixes_run on public.fixes (run_id);
-- Dashboard + previous-audit lookups: runs by brand, newest first
create index if not exists runs_brand_created on public.runs (brand_id, created_at desc);
-- RLS predicates (user_id = auth.uid()) run on EVERY query of these tables
create index if not exists runs_user on public.runs (user_id);
create index if not exists brands_user on public.brands (user_id);
create index if not exists answers_user on public.answers (user_id);
create index if not exists checks_user on public.domain_checks (user_id);
create index if not exists fixes_user on public.fixes (user_id);
create index if not exists corpus_user on public.corpus_pages (user_id);
