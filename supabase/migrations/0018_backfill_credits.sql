-- Backfill the credit ledger so current balances exactly equal
-- today's remaining audits, reconcilable against `runs`. Idempotent: every
-- insert is INSERT … SELECT … ON CONFLICT (idempotency_key) DO NOTHING, so
-- re-running is safe and never double-grants or double-consumes.
--
-- Reconciliation (matches the reserve-on-active + consume-on-done model, 0017):
--   * grant  +audit_purchases per profile (skip audit_purchases = 0 to avoid the
--            check(delta <> 0) violation), keyed `backfill-grant:{user_id}`.
--   * consume -1 per NON-pro user's non-failed AUDIT run, keyed `run:{run_id}`,
--            so future consume-on-done dedups against these rows. Pro users'
--            runs are NOT backfill-consumed (they are never gated/consumed
--            going forward), so pro balance = purchases, non-pro = purchases − used.

insert into public.credit_ledger (user_id, delta, kind, idempotency_key, reason)
select p.id, p.audit_purchases, 'backfill', 'backfill-grant:' || p.id::text,
       'backfill of audit_purchases (0018)'
from public.profiles p
where p.audit_purchases > 0
on conflict (idempotency_key) do nothing;

insert into public.credit_ledger (user_id, delta, kind, run_id, idempotency_key)
select r.user_id, -1, 'consume', r.id, 'run:' || r.id::text
from public.runs r
join public.profiles p on p.id = r.user_id
where r.kind = 'audit'
  and r.status <> 'failed'
  and p.plan <> 'pro'
on conflict (idempotency_key) do nothing;
