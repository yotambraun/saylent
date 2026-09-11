-- The support surface's backing store and
-- the server-side, cookie-free product-analytics event log.
--
-- Style mirrors 0016/0025 (revoke-then-grant column model), 0020 (private.is_admin()
-- SECURITY DEFINER + app-level audit: the acting admin is passed in as p_actor
-- because auth.uid() is NULL under the service role), and 0024/0025/0026
-- (service-role-only tables: enable RLS, admins may SELECT via is_admin(), NO write
-- policy, revoke table write privileges — every row is written by server code
-- holding the service role, never by a browser).

-- ============================================================================
-- A. support_requests — the in-app "Contact support" intake + admin work queue.
-- ----------------------------------------------------------------------------
-- Rows are inserted by the service role only (the in-app form posts to /api/support,
-- which uses the admin client after reading the caller's session): the table grants
-- anon/authenticated NOTHING. user_id is nullable so a future public/logged-out
-- contact form also works; when a logged-in user submits, their id + auto-attached
-- run/brand context ride along in the row. Admins may READ the queue via the same
-- is_admin() predicate audit_log/takedowns use; resolution goes through the audited
-- RPC below (status + audit_log in one transaction).
create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  email text,
  subject text,
  body text not null,
  context jsonb,                       -- { run_id?, brand_id?, path? } auto-attached
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);
create index support_requests_status_idx on public.support_requests (status, created_at desc);
alter table public.support_requests enable row level security;
-- admins may READ the queue; NO write policy (service-role only writes).
create policy "admin read support" on public.support_requests for select to authenticated
  using ((select private.is_admin()));
revoke insert, update, delete, truncate on public.support_requests from authenticated, anon;

-- Resolve a support request (status + audit_log in ONE transaction, so a state
-- change can never be recorded without its audit trail — the admin_resolve_takedown
-- pattern). SECURITY DEFINER + revoked REST surface + service-role-only execute:
-- only a server action that has already run requireAdmin() can reach it, passing
-- the acting admin as p_actor.
create function public.admin_resolve_support(p_actor uuid, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'reason required'; end if;
  update public.support_requests
    set status = 'resolved', resolved_at = now(), resolved_by = p_actor
    where id = p_id and status = 'open';
  if not found then raise exception 'support request not found or already resolved'; end if;
  insert into public.audit_log (actor_id, action, target_table, target_id, after, reason)
  values (p_actor, 'support.resolve', 'support_requests', p_id::text,
          jsonb_build_object('status', 'resolved'), p_reason);
end $$;
revoke all on function public.admin_resolve_support(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.admin_resolve_support(uuid,uuid,text) to service_role;

-- ============================================================================
-- B. analytics_events — server-side, cookie-free product-analytics event log.
-- ----------------------------------------------------------------------------
-- COOKIE-FREE by design: events are written by our own server
-- code to our own DB — no third-party tag, no tracking cookie, so no consent
-- banner is required. Authed events are keyed by user_id (from the session);
-- pre-auth events carry an anon_id the client keeps in sessionStorage (NOT a
-- cookie — never sent automatically, cleared when the tab closes). Service-role
-- ONLY: RLS on, NO policy at all (not even admin SELECT — the admin funnel view
-- reads through the service-role client, which bypasses RLS), all table
-- privileges revoked.
create table public.analytics_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,                        -- no FK: keep the event log even after a profile is deleted
  anon_id text,
  event text not null,
  props jsonb
);
create index analytics_events_event_at_idx on public.analytics_events (event, at);
alter table public.analytics_events enable row level security;
-- NO policy: service-role code is the only reader and writer.
revoke all on public.analytics_events from authenticated, anon;
