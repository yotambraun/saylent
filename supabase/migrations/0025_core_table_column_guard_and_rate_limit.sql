-- Security hardening. Two integrity hardenings:
--   A. Column-locks on the six core tables (the 0016 revoke-then-grant idiom).
--   B. A durable, Postgres-backed rate limiter (table + atomic RPC).
--
-- ============================================================================
-- A. Core-table column guard
-- ----------------------------------------------------------------------------
-- brands / runs / answers / corpus_pages / domain_checks / fixes were created
-- (0002–0006) with a `for all` "own X" policy — row isolation is correct, but
-- `authenticated` still holds blanket INSERT/UPDATE/DELETE, so a signed-in user
-- can PATCH their OWN run to fabricate a "done" dossier (runs.status/scores), or
-- INSERT forged answers/corpus/checks/fixes directly. RLS blocks cross-user
-- access; this closes the write-your-own-integrity hole.
--
-- The engine and createRun/retryRun write every one of these tables through the
-- SERVICE ROLE (src/lib/db.ts createDbWriter + src/lib/runs.ts) which bypasses
-- RLS and role grants — so revoking `authenticated` writes does NOT touch the
-- pipeline. We re-grant ONLY the two columns a user legitimately writes directly:
--   • runs.share_token   — the owner-only share route (api/runs/[id]/share) runs
--                          on the USER client and sets exactly this column.
--   • fixes.published_at — "Mark as shipped" (run/[id]/actions.ts) on the USER
--                          client sets exactly this column.
-- answers / corpus_pages / domain_checks get NO direct user writes at all.
--
-- brands is intentionally LEFT AS-IS: createBrand (onboarding/actions.ts) and
-- updateBrand (settings/actions.ts) both run on the USER client and legitimately
-- INSERT/UPDATE the user's own brand rows (name/domain/competitors/category and
-- the frozen question_set). Locking brands would break brand creation/editing.
--
-- SELECT policies are untouched — cross-user isolation (rls-proof.ts) still holds:
-- these revokes remove only INSERT/UPDATE/DELETE, never SELECT.
-- Cascade deletes (0022) run as the table owner, so revoking DELETE is safe.

revoke insert, update, delete, truncate on public.runs from authenticated, anon;
grant update (share_token) on public.runs to authenticated;

revoke insert, update, delete, truncate on public.fixes from authenticated, anon;
grant update (published_at) on public.fixes to authenticated;

revoke insert, update, delete, truncate on public.answers from authenticated, anon;
revoke insert, update, delete, truncate on public.corpus_pages from authenticated, anon;
revoke insert, update, delete, truncate on public.domain_checks from authenticated, anon;

-- ============================================================================
-- B. Durable rate limiter
-- ----------------------------------------------------------------------------
-- The in-memory Map in /api/waitlist is decorative on serverless (per-instance,
-- reset on cold start). This fixed-window counter is shared across all instances.
-- Keyed by (bucket, identifier): identifier = user id for /api/runs, IP for
-- /api/waitlist. Written only by the service role via the rate_limit_hit RPC.

create table public.rate_limit_hits (
  bucket text not null,
  identifier text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, identifier, window_start)
);
alter table public.rate_limit_hits enable row level security;
-- No policies + no grants: only the SECURITY DEFINER RPC and the service role
-- (which bypasses RLS) ever touch this table.
revoke all on public.rate_limit_hits from authenticated, anon;

-- Atomic increment-and-check for the current fixed window. Returns true when the
-- request is ALLOWED (post-increment count <= limit), false when over the limit.
-- The insert…on conflict…returning is a single row-locked statement, so two
-- concurrent hits cannot both read a stale count. Prunes prior windows for the
-- key on each call, keeping the table to one row per active key.
create or replace function public.rate_limit_hit(
  p_bucket text,
  p_identifier text,
  p_limit int,
  p_window_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count int;
begin
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );
  insert into public.rate_limit_hits (bucket, identifier, window_start, count)
    values (p_bucket, p_identifier, v_window_start, 1)
  on conflict (bucket, identifier, window_start)
    do update set count = public.rate_limit_hits.count + 1
  returning count into v_count;
  delete from public.rate_limit_hits
    where bucket = p_bucket and identifier = p_identifier and window_start < v_window_start;
  return v_count <= p_limit;
end;
$$;

revoke all on function public.rate_limit_hit(text, text, int, int) from public;
grant execute on function public.rate_limit_hit(text, text, int, int) to service_role;
