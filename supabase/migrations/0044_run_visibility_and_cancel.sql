-- Two owner actions that the 0025 column guard silently disabled.
--
-- 0025 revoked insert/update/delete on public.runs from `authenticated` and
-- re-granted exactly ONE column (share_token), so a signed-in user can never
-- rewrite the result of a run that already happened. That is still the rule.
--
-- 0038 then added runs.hidden_at and reasoned only about RLS ("the owner policy
-- from 0002 is `for all`, so no new policy is required"). True, and beside the
-- point: an RLS policy decides which ROWS you may touch, a column grant decides
-- which COLUMNS. With the grant missing, every owner action that writes a runs
-- column other than share_token fails with 42501 "permission denied for table
-- runs" before RLS is ever consulted:
--   * hideRun / unhideRun          (app/run/[id]/actions.ts) — hidden_at
--   * deleteBrand's run cascade    (app/settings/actions.ts) — hidden_at
--   * cancelRun                    (app/run/[id]/actions.ts) — status, error,
--                                                              finished_at
-- The server actions surfaced the error honestly rather than pretending to
-- succeed, so no data is wrong; the buttons simply never worked. rls-proof.ts
-- only exercised cross-user BRANDS isolation, which is why nothing caught it.
--
-- The two halves are fixed differently, on purpose.
--
-- A. hidden_at is a visibility flag on your own run. It changes no number, no
--    evidence and no cost; the run stays reachable by direct URL and the RLS
--    owner policy still limits you to your own rows. That is the same shape as
--    share_token, so it gets the same treatment: one more granted column.
alter table public.runs add column if not exists hidden_at timestamptz; -- no-op after 0038
grant update (hidden_at) on public.runs to authenticated;

-- B. Cancel writes status/error/finished_at — the fields that say what a run
--    RESULTED IN. Granting those to `authenticated` would let any owner flip a
--    queued run to whatever status they liked, which is exactly the forgery the
--    column guard exists to prevent. So cancel does not get a grant: it gets a
--    narrow SECURITY DEFINER function that can only ever perform the one
--    transition the UI offers.
--
--    Guarantees, all enforced inside the function, not by the caller:
--      * ownership — `user_id = auth.uid()`, so someone else's run id does
--        nothing (returns false, identical to an already-finished run: a
--        stranger's run id is not confirmed to exist).
--      * one direction — `status in ('queued','running')`. A done or failed run
--        is never touched, so a finished audit can never be rewritten as failed.
--      * one wording — the note is written by the function, not passed in, so
--        `runs.error` cannot be used as free text a user controls.
--      * anon gets nothing: EXECUTE is revoked from public AND anon (Supabase's
--        default privileges grant anon execute on new public functions, so a
--        revoke from public alone would leave it), and even if called, auth.uid()
--        is null for anon and the predicate fails.
--      * an empty search_path, with every object schema-qualified, so a
--        SECURITY DEFINER body can never resolve a same-named object planted in
--        a schema the caller controls.
--
--    Unchanged from the server action it replaces: the honest caveat that this
--    stops the run on OUR side. The Inngest pipeline does not re-check status
--    between steps, so an in-flight stage can still finish and db.ts setStage
--    can still write status:'running' over this. The UI copy says so.
create or replace function public.cancel_run(p_run_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.runs
     set status = 'failed',
         error = 'cancelled by you',
         finished_at = pg_catalog.now()
   where id = p_run_id
     and user_id = auth.uid()
     and status in ('queued', 'running')
  returning id into v_id;
  return v_id is not null;
end;
$$;

revoke all on function public.cancel_run(uuid) from public, anon, authenticated;
grant execute on function public.cancel_run(uuid) to authenticated, service_role;
