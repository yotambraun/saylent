-- Run-health "birth certificate" (admin quality system) + the delivered-report
-- snapshot + the icp/problems user-edit merge flag. Style mirrors 0026/0028
-- (service-role-only internal tables: RLS on, admins may SELECT via
-- private.is_admin(), NO write policy, table write privileges revoked — every row
-- is written by server code holding the service role, never by a browser) and
-- 0029 (additive `alter table ... add column if not exists`).

-- ============================================================================
-- A. runs.health — the persisted RunHealth (src/lib/run-health.ts) the pipeline's
--    final/failure step writes; read by the operator console (/admin/runs). Lives
--    on runs (already RLS'd to the owner, 0003); the grade is an honest admin
--    signal, so owner-readability is harmless — no new policy needed. jsonb shape:
--    { v, grade, answers, zero_citation_answers, judge_parse_failures, corpus,
--      artifacts, weak_result, est_cost_usd, duration_s, notes }.
-- ----------------------------------------------------------------------------
alter table public.runs add column if not exists health jsonb;
comment on column public.runs.health is
  'Persisted RunHealth birth certificate (src/lib/run-health.ts) — written by the Inngest pipeline at done/failed, read by the operator console. NOT derived at read time.';

-- ============================================================================
-- B. run_snapshots — the permanent record of the dossier payload the customer
--    actually received (get_dossier RPC output captured at done). Service-role
--    ONLY: RLS on, admins may READ via private.is_admin(), NO write policy, all
--    table write privileges revoked. Users never read snapshots — the owner reads
--    the live dossier; this is the immutable "what was delivered" archive.
-- ----------------------------------------------------------------------------
create table if not exists public.run_snapshots (
  run_id uuid primary key references public.runs(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.run_snapshots enable row level security;
-- admins may READ the archive; NO write policy (service-role-only writes).
create policy "admin read run snapshots" on public.run_snapshots for select to authenticated
  using ((select private.is_admin()));
revoke insert, update, delete, truncate on public.run_snapshots from authenticated, anon;

-- ============================================================================
-- C. brands.context_source — the icp/problems edit-source flag ('model' | 'user').
--    'model' (default) = the buyer context is audit-derived; a fresh audit may
--    re-derive icp/problems. 'user' = the owner edited it in settings; a
--    subsequent audit KEEPS the stored icp/problems instead of overwriting them
--    with the freshly-built brand model (src/inngest/functions.ts brand-model
--    step). A user edit permanently wins until they clear the field.
-- ----------------------------------------------------------------------------
alter table public.brands
  add column if not exists context_source text not null default 'model';
comment on column public.brands.context_source is
  'icp/problems edit source: model (audit-derived, may re-derive) | user (owner-edited, kept until cleared). Set to user by updateBrand; honored by the pipeline brand-model step.';
