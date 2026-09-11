-- Admin panel. Adds a service-role-only `role` column, an admin
-- predicate for RLS, an append-only audit_log, and an atomic credit-adjust RPC.
--
-- APP-LEVEL AUDIT (why the actor is passed explicitly): the admin panel reads
-- and writes cross-user data through the SERVICE-ROLE client, under which
-- auth.uid() is NULL. So there is no ambient "current admin" for these functions
-- to record — the calling server action (which has already run requireAdmin())
-- passes the acting admin's id in as p_actor. Row-level enforcement of who may
-- act as admin stays in requireAdmin() (session client, caller's own row); the
-- audit_log and admin_adjust_credits functions trust p_actor because only
-- service-role code (never a browser) can reach them.
--
-- Style mirrors 0016 (revoke-then-grant column model), 0015 ((select auth.uid())
-- initplan), and 0010/0017 (security definer + set search_path).

-- role: NOT self-writable. 0016 revoked the blanket UPDATE on profiles and
-- re-grants only specific columns to `authenticated`; a brand-new column is
-- therefore writable by the service role ONLY. Do NOT grant UPDATE(role).
alter table public.profiles add column role text not null default 'user'
  check (role in ('user','admin'));

-- private schema is NOT in PostgREST's exposed schemas, so is_admin() is not a
-- callable REST endpoint; it exists purely for RLS predicates.
create schema if not exists private;

create function private.is_admin() returns boolean
  language sql security definer set search_path = public stable as
$$ select exists (select 1 from public.profiles
     where id = (select auth.uid()) and role = 'admin') $$;
-- granted to authenticated for use inside RLS USING clauses; it only ever
-- reveals the CALLER's own admin bit (auth.uid() is the caller under RLS).
grant execute on function private.is_admin() to authenticated;

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid not null references public.profiles(id),
  action text not null,
  target_user_id uuid references public.profiles(id),
  target_table text, target_id text,
  before jsonb, after jsonb,
  reason text not null,
  request_meta jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);
alter table public.audit_log enable row level security;
-- admins may READ the audit log; NO write policy (service-role only writes).
create policy "admin read audit" on public.audit_log for select to authenticated
  using ((select private.is_admin()));
revoke insert, update, delete, truncate on public.audit_log from authenticated, anon;

-- Atomic credit adjustment: writes the ledger row AND the audit_log row in one
-- transaction so a grant/revoke can never be recorded without its audit trail.
-- p_actor is the acting admin (passed explicitly; see header). SECURITY DEFINER
-- + service-role-only execute grant keep this off the REST surface.
create function public.admin_adjust_credits(
  p_actor uuid, p_target uuid, p_delta int, p_reason text)
returns int language plpgsql security definer set search_path = public as $$
declare new_bal int;
begin
  if p_delta = 0 then raise exception 'delta must be non-zero'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'reason required'; end if;
  insert into public.credit_ledger (user_id, delta, kind, idempotency_key, reason, created_by)
  values (p_target, p_delta, case when p_delta > 0 then 'admin_grant' else 'admin_revoke' end,
          'admin:' || gen_random_uuid()::text, p_reason, p_actor);
  select coalesce(sum(delta),0) into new_bal from public.credit_ledger where user_id = p_target;
  insert into public.audit_log (actor_id, action, target_user_id, target_table, target_id, after, reason)
  values (p_actor, case when p_delta>0 then 'credit.grant' else 'credit.revoke' end,
          p_target, 'credit_ledger', p_target::text,
          jsonb_build_object('delta', p_delta, 'new_balance', new_bal), p_reason);
  return new_bal;
end $$;
revoke all on function public.admin_adjust_credits(uuid,uuid,int,text) from public, anon, authenticated;
