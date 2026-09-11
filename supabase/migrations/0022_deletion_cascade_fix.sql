-- Account-deletion cascade fix. The spec promises that a service-role
-- `deleteUser` wipes every row via FK cascades, but 0017 (credit_ledger)
-- and 0020 (audit_log) landed FKs that BLOCK that cascade: credit_ledger.user_id
-- was `on delete restrict`, and run_id/created_by/actor_id/target_user_id all
-- defaulted to NO ACTION. So any user who ever held a ledger row (every purchaser
-- or admin-grant recipient) or appeared in the audit log could not be deleted —
-- the delete route 500'd. GDPR erasure requires the delete to succeed.
--
-- Semantics: per-user balance rows die WITH the user (erasure); audit-log lines
-- SURVIVE but are anonymized (accountability trail without PII). Constraint names
-- are Postgres' deterministic `{table}_{column}_fkey` defaults (verified against
-- information_schema on saylent-dev before writing). Style mirrors 0016/0020's
-- drop-then-add constraint model.

-- credit_ledger.user_id: restrict → cascade (the user's own balance rows).
alter table public.credit_ledger drop constraint credit_ledger_user_id_fkey;
alter table public.credit_ledger add constraint credit_ledger_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

-- credit_ledger.run_id: NO ACTION → cascade. runs already cascade from profiles;
-- without this, the order in which the user-delete cascade drops runs vs. ledger
-- rows could violate the FK. Make it consistent.
alter table public.credit_ledger drop constraint credit_ledger_run_id_fkey;
alter table public.credit_ledger add constraint credit_ledger_run_id_fkey
  foreign key (run_id) references public.runs(id) on delete cascade;

-- credit_ledger.created_by (already nullable): NO ACTION → set null. An admin
-- who granted credits may be deleted without erasing the grantee's balance row.
alter table public.credit_ledger drop constraint credit_ledger_created_by_fkey;
alter table public.credit_ledger add constraint credit_ledger_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

-- stripe_event_id is left as-is: stripe_events has no user FK, so it never blocks
-- a user delete.

-- audit_log.actor_id: NOT NULL + NO ACTION → nullable + set null. The log line
-- survives the acting admin's deletion, anonymized.
alter table public.audit_log alter column actor_id drop not null;
alter table public.audit_log drop constraint audit_log_actor_id_fkey;
alter table public.audit_log add constraint audit_log_actor_id_fkey
  foreign key (actor_id) references public.profiles(id) on delete set null;

-- audit_log.target_user_id (already nullable): NO ACTION → set null. The log line
-- survives the target's deletion, anonymized.
alter table public.audit_log drop constraint audit_log_target_user_id_fkey;
alter table public.audit_log add constraint audit_log_target_user_id_fkey
  foreign key (target_user_id) references public.profiles(id) on delete set null;
