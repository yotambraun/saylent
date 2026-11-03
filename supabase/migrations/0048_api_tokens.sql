-- Personal API tokens for the read-only API (/api/v1/*).
--
-- A token is `slt_` + 32 random bytes (base64url), shown to its owner ONCE.
-- Only its SHA-256 hash is stored, so a database read never yields a usable
-- token; `prefix` (the first characters) is kept so the owner can tell their
-- tokens apart in Settings › API tokens.
--
-- WHO READS WHAT
--   * The owner's browser (authenticated) may SELECT their own rows, every
--     column except token_hash, which is deliberately absent from the grant.
--   * Creating and revoking go through server actions that check the session
--     first, then write with the service role (the 0047 pattern). No
--     insert/update/delete grant to authenticated or anon.
--   * The API resolves a presented token with resolve_api_token(), executable
--     by the service role only. It returns the owner only for a token that is
--     neither revoked nor expired, and stamps last_used_at at most once a
--     minute so a busy script does not turn every read into a write.
--
-- What the API then reads is scoped to that owner the way the share page is
-- (dossier-data.ts getSharedRun): the service client, with the owner checked
-- on the run or brand row FIRST and child rows read only by an id that passed
-- that check. src/lib/api-auth.ts is the one place that happens.
--
-- RLS / GRANTS follow 0023/0026/0047: revoke-all-then-grant, initplan-wrapped
-- auth.uid(), an empty search_path in the SECURITY DEFINER body, EXECUTE
-- revoked from public AND anon.

create table if not exists public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  prefix text not null check (char_length(prefix) between 4 and 16),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);

create index if not exists api_tokens_user_idx on public.api_tokens (user_id, created_at desc);

alter table public.api_tokens enable row level security;

drop policy if exists "own api tokens read" on public.api_tokens;
create policy "own api tokens read" on public.api_tokens for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.api_tokens from authenticated, anon;
-- token_hash is deliberately absent from this grant
grant select (id, user_id, name, prefix, created_at, last_used_at, expires_at, revoked_at) on public.api_tokens to authenticated;

comment on table public.api_tokens is
  'Personal read-only API tokens (0048). Only the SHA-256 hash is stored and it is never granted to the browser; writes are service-role only, after a session check.';

create or replace function public.resolve_api_token(p_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_user uuid;
  v_last timestamptz;
begin
  select t.id, t.user_id, t.last_used_at
    into v_id, v_user, v_last
    from public.api_tokens t
   where t.token_hash = p_hash
     and t.revoked_at is null
     and (t.expires_at is null or t.expires_at > pg_catalog.now());
  if v_id is null then
    return null;
  end if;
  if v_last is null or v_last < pg_catalog.now() - interval '1 minute' then
    update public.api_tokens set last_used_at = pg_catalog.now() where id = v_id;
  end if;
  return v_user;
end;
$$;

revoke all on function public.resolve_api_token(text) from public, anon, authenticated;
grant execute on function public.resolve_api_token(text) to service_role;
