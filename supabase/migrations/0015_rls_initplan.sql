-- RLS performance (Supabase advisor lint
-- 0003_auth_rls_initplan): wrap auth.uid() in a sub-select so Postgres
-- evaluates it ONCE per statement instead of once per row (documented >90%
-- gains), and scope policies to the authenticated role so anon requests skip
-- evaluation entirely. Matters most for get_dossier(), which fires RLS on six
-- tables in one call. Semantics unchanged: same owner-only access.

drop policy "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy "own brands" on public.brands;
create policy "own brands" on public.brands
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy "own runs" on public.runs;
create policy "own runs" on public.runs
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy "own answers" on public.answers;
create policy "own answers" on public.answers
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy "own corpus" on public.corpus_pages;
create policy "own corpus" on public.corpus_pages
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy "own checks" on public.domain_checks;
create policy "own checks" on public.domain_checks
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy "own fixes" on public.fixes;
create policy "own fixes" on public.fixes
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
