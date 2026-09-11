-- Privilege-escalation fix. Before this migration
-- `authenticated` held table-wide UPDATE on public.profiles and the "own profile"
-- policy was FOR ALL with no column guard — so a signed-in user could PATCH their
-- own `plan` or `audit_purchases` (buy themselves paid access for free).
--
-- Defense is two-layered and unchanged in row semantics (still owner-only):
--   1. Column privilege: revoke the blanket UPDATE and grant it back only on
--      `email_reports` (the sole column a user legitimately self-edits today).
--      `plan` / `audit_purchases` become writable by the service role ONLY.
--   2. RLS: split the FOR ALL policy into explicit SELECT + UPDATE policies, both
--      scoped to the row owner (initplan-wrapped auth.uid() per 0015).
-- Together: a user can read their whole row and write only email_reports on it.
--
-- INSERT stays working for signups: handle_new_user() is SECURITY DEFINER, so it
-- runs as the function owner and is unaffected by the revoke — do NOT grant INSERT
-- back to authenticated (that is what reopened the hole).

revoke update, insert, delete, truncate on public.profiles from authenticated, anon;

grant update (email_reports) on public.profiles to authenticated;

drop policy "own profile" on public.profiles;

create policy "own profile select" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "own profile update" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
