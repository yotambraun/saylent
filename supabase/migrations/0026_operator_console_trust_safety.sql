-- The operator console's schema and the
-- trust-&-safety layer (consent attestation, takedown intake, blocked domains).
--
-- Style mirrors 0016 (revoke-then-grant column model), 0020 (private.is_admin()
-- SECURITY DEFINER + app-level audit: the acting admin's id is passed in as
-- p_actor because auth.uid() is NULL under the service role), and 0024/0025
-- (service-role-only tables: enable RLS, no write policy, revoke table privileges).
--
-- ATOMIC AUDIT: every privileged mutation added here ships as a SECURITY DEFINER
-- RPC that writes its state change AND its audit_log row in ONE transaction —
-- exactly like admin_adjust_credits (0020). A grant/revoke/disable can never be
-- recorded without its audit trail, or vice-versa. Actions that touch an external
-- system (GoTrue ban, Inngest dispatch, Stripe) can't share a SQL txn and use a
-- checked compensating sequence in the server action instead.

-- ============================================================================
-- A. TRUST-SAFETY schema
-- ----------------------------------------------------------------------------

-- 1) Consent attestation on brands. Nullable (nothing backfilled). brands stays
--    user-writable (0025 left its blanket grants in place so createBrand/updateBrand
--    work on the USER client), so the owner sets authorized_at at creation via
--    their own RLS insert — it's THEIR attestation ("I'm authorized to audit this
--    brand"), recorded with who attested (their email).
alter table public.brands add column authorized_at timestamptz;
alter table public.brands add column authorized_by text;
comment on column public.brands.authorized_at is
  'TRUST-SAFETY: when the owner attested authorization to audit this brand (consent shield).';

-- 2) blocked_domains — domains we have been asked to stop auditing / obvious abuse
--    targets. Checked in createBrand AND createRun. Service-role ONLY: RLS on, no
--    policy, table privileges revoked (0024/0025 idiom). Reads go through the admin
--    client (src/lib/blocked-domains.ts); writes through the audited RPCs below.
create table public.blocked_domains (
  domain text primary key,
  reason text,
  added_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.blocked_domains enable row level security;
revoke all on public.blocked_domains from authenticated, anon;

-- 3) takedown_requests — the public "this dossier is about us, we didn't consent"
--    intake, plus the admin work queue. Rows are inserted by the service role only
--    (the public form posts to a server action that uses the admin client, so the
--    table itself grants anon/authenticated nothing). Admins may READ via the same
--    is_admin() predicate the audit_log uses; no direct write policy.
create table public.takedown_requests (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brands(id) on delete set null,
  run_id uuid references public.runs(id) on delete set null,
  reporter_email text,
  claim text not null,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);
create index takedown_requests_status_idx on public.takedown_requests (status, created_at desc);
alter table public.takedown_requests enable row level security;
-- admins may READ the queue; NO write policy (service-role only writes).
create policy "admin read takedowns" on public.takedown_requests for select to authenticated
  using ((select private.is_admin()));
revoke insert, update, delete, truncate on public.takedown_requests from authenticated, anon;

-- ============================================================================
-- B. Audited operator-console RPCs (mutation + audit_log in one transaction)
-- ----------------------------------------------------------------------------
-- All are SECURITY DEFINER with a revoked REST surface + a service-role-only
-- execute grant, so only server actions (which have already run requireAdmin())
-- can reach them, passing the acting admin as p_actor.

-- mark a stuck/hung run as failed (the manual watchdog).
create function public.admin_mark_run_failed(p_actor uuid, p_run_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_before text;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'reason required'; end if;
  select status into v_before from public.runs where id = p_run_id;
  if v_before is null then raise exception 'run not found'; end if;
  update public.runs set status = 'failed', error = p_reason where id = p_run_id;
  insert into public.audit_log (actor_id, action, target_table, target_id, before, after, reason)
  values (p_actor, 'run.mark_failed', 'runs', p_run_id::text,
          jsonb_build_object('status', v_before), jsonb_build_object('status', 'failed'), p_reason);
end $$;
revoke all on function public.admin_mark_run_failed(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.admin_mark_run_failed(uuid,uuid,text) to service_role;

-- comp / support: override a user's plan (none|audit|pro).
create function public.admin_set_plan(p_actor uuid, p_target uuid, p_plan text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_before text;
begin
  if p_plan not in ('none','audit','pro') then raise exception 'invalid plan'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'reason required'; end if;
  select plan into v_before from public.profiles where id = p_target;
  if v_before is null then raise exception 'user not found'; end if;
  update public.profiles set plan = p_plan where id = p_target;
  insert into public.audit_log (actor_id, action, target_user_id, target_table, target_id, before, after, reason)
  values (p_actor, 'plan.override', p_target, 'profiles', p_target::text,
          jsonb_build_object('plan', v_before), jsonb_build_object('plan', p_plan), p_reason);
end $$;
revoke all on function public.admin_set_plan(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.admin_set_plan(uuid,uuid,text,text) to service_role;

-- trust-safety: unpublish a run's share link (null the token).
create function public.admin_unpublish_share(p_actor uuid, p_run_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'reason required'; end if;
  update public.runs set share_token = null where id = p_run_id;
  insert into public.audit_log (actor_id, action, target_table, target_id, after, reason)
  values (p_actor, 'share.unpublish', 'runs', p_run_id::text,
          jsonb_build_object('share_token', null), p_reason);
end $$;
revoke all on function public.admin_unpublish_share(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.admin_unpublish_share(uuid,uuid,text) to service_role;

-- trust-safety: add a domain to the blocklist (refuses future brands + runs).
create function public.admin_block_domain(p_actor uuid, p_domain text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_domain text := lower(trim(p_domain));
begin
  if v_domain = '' then raise exception 'domain required'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'reason required'; end if;
  insert into public.blocked_domains (domain, reason, added_by)
  values (v_domain, p_reason, p_actor)
  on conflict (domain) do update set reason = excluded.reason, added_by = excluded.added_by;
  insert into public.audit_log (actor_id, action, target_table, target_id, after, reason)
  values (p_actor, 'domain.block', 'blocked_domains', v_domain,
          jsonb_build_object('domain', v_domain), p_reason);
end $$;
revoke all on function public.admin_block_domain(uuid,text,text) from public, anon, authenticated;
grant execute on function public.admin_block_domain(uuid,text,text) to service_role;

-- trust-safety: disable ONE brand — block its domain AND kill all its live share
-- links, in one txn. Distinct from admin_block_domain (which is a raw, brand-less
-- domain entry): this is the "act on this specific brand" convenience.
create function public.admin_disable_brand(p_actor uuid, p_brand_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_domain text;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'reason required'; end if;
  select lower(domain) into v_domain from public.brands where id = p_brand_id;
  if v_domain is null then raise exception 'brand not found'; end if;
  insert into public.blocked_domains (domain, reason, added_by)
  values (v_domain, p_reason, p_actor)
  on conflict (domain) do update set reason = excluded.reason, added_by = excluded.added_by;
  update public.runs set share_token = null where brand_id = p_brand_id and share_token is not null;
  insert into public.audit_log (actor_id, action, target_table, target_id, after, reason)
  values (p_actor, 'brand.disable', 'brands', p_brand_id::text,
          jsonb_build_object('domain', v_domain, 'shares_revoked', true), p_reason);
end $$;
revoke all on function public.admin_disable_brand(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.admin_disable_brand(uuid,uuid,text) to service_role;

-- trust-safety: resolve/dismiss a takedown request.
create function public.admin_resolve_takedown(p_actor uuid, p_id uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('resolved','dismissed') then raise exception 'invalid status'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'reason required'; end if;
  update public.takedown_requests
    set status = p_status, resolved_at = now(), resolved_by = p_actor
    where id = p_id;
  if not found then raise exception 'takedown not found'; end if;
  insert into public.audit_log (actor_id, action, target_table, target_id, after, reason)
  values (p_actor, 'takedown.' || p_status, 'takedown_requests', p_id::text,
          jsonb_build_object('status', p_status), p_reason);
end $$;
revoke all on function public.admin_resolve_takedown(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.admin_resolve_takedown(uuid,uuid,text,text) to service_role;

-- cost-control: set (or clear) the daily spend cap — the kill switch's companion.
create function public.admin_set_daily_cap(p_actor uuid, p_cap numeric, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'reason required'; end if;
  if p_cap is not null and p_cap < 0 then raise exception 'cap must be >= 0'; end if;
  insert into public.app_settings (id, daily_spend_cap_usd, updated_at)
  values (true, p_cap, now())
  on conflict (id) do update set daily_spend_cap_usd = excluded.daily_spend_cap_usd, updated_at = now();
  insert into public.audit_log (actor_id, action, target_table, target_id, after, reason)
  values (p_actor, 'spend.set_cap', 'app_settings', 'global',
          jsonb_build_object('daily_spend_cap_usd', p_cap), p_reason);
end $$;
revoke all on function public.admin_set_daily_cap(uuid,numeric,text) from public, anon, authenticated;
grant execute on function public.admin_set_daily_cap(uuid,numeric,text) to service_role;

-- ============================================================================
-- C. get_dossier — surface the consent attestation to the methodology/share section.
-- ----------------------------------------------------------------------------
-- ONLY change vs 0021: the brand object gains authorized_at (so the dossier's
-- Methodology section can show the quiet "Prepared with the requester's
-- authorization" line). Signature, return type, SECURITY INVOKER default, and the
-- rest of the payload are identical — RLS still applies inside every subquery.
create or replace function public.get_dossier(p_run_id uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'run', to_jsonb(r) - 'user_id',
    'brand', (
      select jsonb_build_object(
        'name', b.name, 'domain', b.domain,
        'aliases', b.aliases, 'competitors', b.competitors,
        'authorized_at', b.authorized_at
      )
      from public.brands b where b.id = r.brand_id
    ),
    'answers', (
      select coalesce(jsonb_agg(to_jsonb(a) - 'user_id' order by a.qid), '[]'::jsonb)
      from public.answers a where a.run_id = r.id
    ),
    'corpus', (
      select coalesce(jsonb_agg(to_jsonb(c) - 'user_id'), '[]'::jsonb)
      from public.corpus_pages c where c.run_id = r.id
    ),
    'checks', (
      select coalesce(jsonb_agg(to_jsonb(d) - 'user_id'), '[]'::jsonb)
      from public.domain_checks d where d.run_id = r.id
    ),
    'fixes', (
      select coalesce(jsonb_agg(to_jsonb(f) - 'user_id' order by f.weight desc), '[]'::jsonb)
      from public.fixes f where f.run_id = r.id
    ),
    'previous', (
      select jsonb_build_object(
        'created_at', p.created_at, 'finished_at', p.finished_at, 'scores', p.scores
      )
      from public.runs p
      where p.brand_id = r.brand_id and p.kind = 'audit' and p.status = 'done'
        and p.profile = r.profile
        and p.created_at < r.created_at
      order by p.created_at desc limit 1
    )
  )
  from public.runs r
  where r.id = p_run_id;
$$;
