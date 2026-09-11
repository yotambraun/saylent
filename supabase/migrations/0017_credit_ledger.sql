-- Credit ledger. Append-only ledger of audit credits.
--
-- Entitlement model: reserve-on-active + consume-on-done, NO refunds. This
-- preserves the pre-ledger semantics exactly (a credit was "used" iff a
-- non-failed audit run existed) with no double-spend leaks:
--   * Gate (createRun, non-pro AUDIT only): available =
--       ledger_balance(user) − count(user's audit runs queued|running).
--     The run being created is not inserted yet, so it is not double-counted.
--     Pro bypasses the gate; verify runs are gated separately (unchanged).
--   * Consume: when an AUDIT run reaches done, for NON-pro users only, insert
--     one -1 row keyed `run:{runId}` (ON CONFLICT DO NOTHING). A failed run
--     never reaches done → never consumed (parity). A retried run that finally
--     succeeds consumes exactly once (the idempotency key dedups). No refund
--     path, no attempt tracking.
--   * Pro users: never gated, never consumed.
--
-- Writes are service-role only: RLS + a missing INSERT/UPDATE/DELETE policy
-- block authenticated/anon, and the sole debit path is the consume_audit_credit
-- SECURITY DEFINER function (per-user anchor lock avoids read-modify-write
-- races). Style matches 0015 (initplan-wrapped auth.uid(), `to authenticated`)
-- and 0010 (security_invoker views).

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  delta int not null check (delta <> 0),
  kind text not null check (kind in ('purchase','admin_grant','consume','admin_revoke','backfill')),
  run_id uuid references public.runs(id),
  stripe_event_id text references public.stripe_events(id),
  idempotency_key text not null unique,
  reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);
alter table public.credit_ledger enable row level security;

-- owner may READ own rows; NO insert/update/delete policy (service-role only writes)
create policy "own ledger read" on public.credit_ledger for select to authenticated
  using ((select auth.uid()) = user_id);
revoke update, delete, truncate on public.credit_ledger from authenticated, anon;
-- (leave the table's default privileges; RLS + missing write policy already blocks writes,
--  but also revoke INSERT from authenticated,anon to be explicit)
revoke insert on public.credit_ledger from authenticated, anon;

create view public.credit_balances with (security_invoker = on) as
  select user_id, coalesce(sum(delta),0)::int as balance
  from public.credit_ledger group by user_id;

-- atomic consume: the ONLY debit path. per-user anchor lock avoids read-modify-write races.
create function public.consume_audit_credit(p_user_id uuid, p_run_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare bal int;
begin
  perform 1 from public.profiles where id = p_user_id for no key update;
  select coalesce(sum(delta),0) into bal from public.credit_ledger where user_id = p_user_id;
  if bal < 1 then return false; end if;
  insert into public.credit_ledger (user_id, delta, kind, run_id, idempotency_key)
  values (p_user_id, -1, 'consume', p_run_id, 'run:' || p_run_id::text)
  on conflict (idempotency_key) do nothing;
  return true;
end $$;
revoke all on function public.consume_audit_credit(uuid, uuid) from public, anon, authenticated;
