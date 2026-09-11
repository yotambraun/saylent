-- Cost-control guardrails (pre-billing, load-bearing).
-- Two DB-level protections that application code cannot race around:
--   1. A partial UNIQUE index enforcing at most ONE active (queued|running) run
--      per brand — kills the TOCTOU double-audit race. createRun still does a
--      friendly pre-check, but the index is the authority: a second concurrent
--      insert fails with unique_violation (SQLSTATE 23505) and createRun maps it
--      to the honest "a run is already in progress" reason.
--   2. app_settings — a single-row global kill switch (runs_paused) + optional
--      daily_spend_cap_usd, togglable at runtime with no redeploy.
-- Style mirrors 0016/0017/0020 (service-role-only tables: revoke, no write
-- policy). consume_audit_credit stays idempotent (keyed run:{runId}); unchanged.

-- 1) One active run per brand, regardless of kind. This matches the existing
--    concurrency guard's intent ("a run is already in progress for this brand").
--    A verify's baseline audit is status='done' (verify requires a completed
--    audit), so a legitimate audit+verify never overlap as two active rows.
--    NOTE on apply: if pre-existing data already has >1 active run for a brand,
--    this index creation will fail — resolve any such duplicates first
--    (update the stale rows to 'failed').
create unique index runs_one_active_per_brand
  on public.runs (brand_id)
  where status in ('queued', 'running');

-- 2) Global runtime settings — kill switch + daily spend cap. Single row keyed
--    id=true. Service-role ONLY: no RLS policy is created (so authenticated/anon
--    get nothing under RLS) and table privileges are revoked explicitly (0016
--    idiom). Reads/writes go through the admin client (src/lib/app-settings.ts):
--    admin `pauseRuns` action (audited) + the spend-ceiling auto-trip.
create table public.app_settings (
  id boolean primary key default true check (id = true),   -- single-row guard
  runs_paused boolean not null default false,
  daily_spend_cap_usd numeric check (daily_spend_cap_usd is null or daily_spend_cap_usd >= 0),
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;
-- No policy = no authenticated/anon access under RLS. Revoke table privileges
-- too, to be explicit (service role bypasses RLS and is unaffected).
revoke all on public.app_settings from authenticated, anon;
