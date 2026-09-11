-- Operator flexibility in the app: provider API keys
-- and per-role model overrides the operator can change in the admin console with NO
-- redeploy. Environment still wins when set; keys are encrypted at rest; a key is
-- never readable from the console after it is saved; every write is audit-logged.
--
-- Style mirrors 0024/0025 (single-row, service-role-only table: enable RLS, no
-- policy, revoke table privileges) and 0020/0026 (SECURITY DEFINER RPC that writes
-- its state change AND its audit_log row in ONE transaction, with the acting admin
-- passed in as p_actor because auth.uid() is NULL under the service role).
--
-- WHY THE SECRET IS AN ARGUMENT, NOT A DATABASE OBJECT
--   pgp_sym_encrypt needs a passphrase. Storing that passphrase anywhere the
--   database can reach — a settings table, a GUC, a hard-coded literal inside a
--   function body — would put the lock and the key in the same box: one leaked
--   dump/backup/read-replica would decrypt every provider key. So APP_SECRET lives
--   ONLY in the deployment's environment and is passed in per call by the server
--   (src/lib/provider-settings.ts). A stolen dump then yields ciphertext only.
--   Trade-off recorded honestly: function arguments are visible to a superuser in
--   pg_stat_activity while the statement runs, and would be written to the log if
--   `log_statement = 'all'` were ever enabled. These functions are reachable only
--   over PostgREST with the service key (never from a browser), so the exposure is
--   the same trust boundary that already holds SUPABASE_SERVICE_ROLE_KEY — and
--   operators are told to leave log_statement off.
--
-- WHY SECURITY DEFINER
--   provider_settings has RLS on, no policy, and every table privilege revoked —
--   the table itself is unreachable by anon/authenticated even if a future default
--   grant were added. SECURITY DEFINER lets these six narrow entry points read and
--   write it while the table stays sealed; EXECUTE is revoked from public/anon/
--   authenticated and granted to service_role only, so definer rights are only
--   reachable from server code that already holds the service key. None of the
--   functions returns key material except get_provider_key/get_provider_keys, which
--   require the caller to supply the correct secret.
--
-- search_path is pinned to `public, extensions` (not just public): Supabase installs
-- pgcrypto into the `extensions` schema, a plain self-hosted Postgres installs it
-- into `public`. Naming both resolves pgp_sym_encrypt on either target, and both are
-- trusted schemas, so the pin still does its search-path-hijack job.

create extension if not exists pgcrypto;

-- ============================================================================
-- A. The table — one row, keyed id=true (the 0024 app_settings idiom).
-- ----------------------------------------------------------------------------
-- keys             provider -> base64(pgp_sym_encrypt(key, APP_SECRET)). Ciphertext
--                  only; the plaintext never lands in a column, an index or a log.
-- model_overrides  ModelRole -> model id (packages/engine/src/models.ts). NOT secret
--                  and NOT encrypted: model ids are public strings, and keeping them
--                  in clear means the console can still manage models on a
--                  deployment that has no APP_SECRET set.
create table public.provider_settings (
  id boolean primary key default true check (id = true),   -- single-row guard
  keys jsonb not null default '{}'::jsonb,
  model_overrides jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.provider_settings (id) values (true) on conflict (id) do nothing;

alter table public.provider_settings enable row level security;
-- No policy = no authenticated/anon access under RLS. Revoke table privileges too,
-- to be explicit (service role bypasses RLS and is unaffected).
revoke all on public.provider_settings from authenticated, anon;

comment on table public.provider_settings is
  'Console-managed provider keys (pgcrypto ciphertext; the passphrase is APP_SECRET, passed per call, never stored) + per-role model overrides. Service-role only; read/written through src/lib/provider-settings.ts.';
comment on column public.provider_settings.keys is
  'provider -> base64(pgp_sym_encrypt(api_key, APP_SECRET)). Ciphertext only — never select this column into the application; use get_provider_key(s).';

-- ============================================================================
-- B. Writers — state change + audit_log row in ONE transaction (0020 rule).
-- ----------------------------------------------------------------------------

-- Set or replace one provider's key. Never logs, returns or audits the key value:
-- the audit `after` records only that a key was set for that provider.
create function public.set_provider_key(
  p_actor uuid, p_provider text, p_key text, p_secret text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_provider not in ('openai','anthropic','gemini','perplexity') then
    raise exception 'unknown provider %', p_provider;
  end if;
  if p_key is null or length(trim(p_key)) = 0 then
    raise exception 'key required';
  end if;
  -- A short passphrase is the whole encryption story, so refuse a weak one here
  -- rather than silently encrypting under it.
  if p_secret is null or length(p_secret) < 16 then
    raise exception 'APP_SECRET must be at least 16 characters';
  end if;
  -- the single row is created by this migration; re-assert it so a writer can
  -- never silently update zero rows.
  insert into public.provider_settings (id) values (true) on conflict (id) do nothing;

  update public.provider_settings
     set keys = keys || jsonb_build_object(
           p_provider, encode(pgp_sym_encrypt(trim(p_key), p_secret), 'base64')),
         updated_by = p_actor,
         updated_at = now()
   where id = true;

  insert into public.audit_log (actor_id, action, target_table, target_id, after, reason)
  values (p_actor, 'provider.key_set', 'provider_settings', p_provider,
          jsonb_build_object('provider', p_provider, 'stored', true),
          'operator set the ' || p_provider || ' API key in the admin console');
end $$;
revoke all on function public.set_provider_key(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.set_provider_key(uuid,text,text,text) to service_role;

create function public.remove_provider_key(p_actor uuid, p_provider text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_provider not in ('openai','anthropic','gemini','perplexity') then
    raise exception 'unknown provider %', p_provider;
  end if;

  update public.provider_settings
     set keys = keys - p_provider, updated_by = p_actor, updated_at = now()
   where id = true;

  insert into public.audit_log (actor_id, action, target_table, target_id, after, reason)
  values (p_actor, 'provider.key_removed', 'provider_settings', p_provider,
          jsonb_build_object('provider', p_provider, 'stored', false),
          'operator removed the ' || p_provider || ' API key in the admin console');
end $$;
revoke all on function public.remove_provider_key(uuid,text) from public, anon, authenticated;
grant execute on function public.remove_provider_key(uuid,text) to service_role;

-- Replace the WHOLE per-role model override map (an empty object is "Reset to
-- defaults"). Whole-map writes keep the audit entry a complete before/after
-- picture of what the registry will do, which per-key patching would not.
create function public.set_model_overrides(p_actor uuid, p_overrides jsonb, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if p_overrides is null or jsonb_typeof(p_overrides) <> 'object' then
    raise exception 'overrides must be a json object';
  end if;
  if exists (select 1 from jsonb_each(p_overrides) e
             where jsonb_typeof(e.value) <> 'string' or length(trim(e.value #>> '{}')) = 0) then
    raise exception 'every model override must be a non-empty string';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason required';
  end if;

  insert into public.provider_settings (id) values (true) on conflict (id) do nothing;
  select model_overrides into v_before from public.provider_settings where id = true;

  update public.provider_settings
     set model_overrides = p_overrides, updated_by = p_actor, updated_at = now()
   where id = true;

  insert into public.audit_log (actor_id, action, target_table, target_id, before, after, reason)
  values (p_actor, 'provider.models_set', 'provider_settings', 'global',
          coalesce(v_before, '{}'::jsonb), p_overrides, trim(p_reason));
end $$;
revoke all on function public.set_model_overrides(uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.set_model_overrides(uuid,jsonb,text) to service_role;

-- ============================================================================
-- C. Readers.
-- ----------------------------------------------------------------------------

-- One provider's plaintext key, for the "Test" button. Raises (rather than
-- returning null) when the secret does not match the stored ciphertext, so a
-- rotated/wrong APP_SECRET is an honest error the console can name instead of a
-- key that silently looks absent.
create function public.get_provider_key(p_provider text, p_secret text)
returns text language plpgsql security definer set search_path = public, extensions stable as $$
declare v_cipher text;
begin
  select keys ->> p_provider into v_cipher from public.provider_settings where id = true;
  if v_cipher is null then return null; end if;
  return pgp_sym_decrypt(decode(v_cipher, 'base64'), p_secret);
end $$;
revoke all on function public.get_provider_key(text,text) from public, anon, authenticated;
grant execute on function public.get_provider_key(text,text) to service_role;

-- Every stored key at once (provider -> plaintext), for the run path: one round
-- trip per run instead of four.
create function public.get_provider_keys(p_secret text)
returns jsonb language plpgsql security definer set search_path = public, extensions stable as $$
declare v_out jsonb := '{}'::jsonb; r record;
begin
  for r in
    select e.key as provider, e.value as cipher
      from public.provider_settings s, jsonb_each_text(s.keys) as e(key, value)
     where s.id = true
  loop
    v_out := v_out || jsonb_build_object(
      r.provider, pgp_sym_decrypt(decode(r.cipher, 'base64'), p_secret));
  end loop;
  return v_out;
end $$;
revoke all on function public.get_provider_keys(text) from public, anon, authenticated;
grant execute on function public.get_provider_keys(text) to service_role;

-- The console's resting state: WHICH providers have a stored key (never the key,
-- never the ciphertext) plus the model overrides. Takes no secret, so the page
-- still renders correctly on a deployment where APP_SECRET is unset.
create function public.provider_settings_state()
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'stored_providers', coalesce((select jsonb_agg(e.key order by e.key)
                                    from jsonb_each(s.keys) as e(key, value)), '[]'::jsonb),
    'model_overrides', s.model_overrides,
    'updated_at', s.updated_at,
    'updated_by', s.updated_by)
  from public.provider_settings s where s.id = true
$$;
revoke all on function public.provider_settings_state() from public, anon, authenticated;
grant execute on function public.provider_settings_state() to service_role;

comment on function public.get_provider_key(text,text) is
  'Decrypt one console-stored provider key. The passphrase (APP_SECRET) is an ARGUMENT and is never stored in the database — see the migration 0042 header for the reasoning and the pg_stat_activity trade-off.';
comment on function public.set_provider_key(uuid,text,text,text) is
  'Encrypt-and-store one provider key + its audit_log row, in one transaction. Neither the key nor its ciphertext is ever written to the audit entry.';
