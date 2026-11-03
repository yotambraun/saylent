-- SerpApi joins the console-managed provider keys.
--
-- The answer SURFACES (Google AI Overviews, Google AI Mode, Microsoft Copilot;
-- packages/engine/src/surfaces.ts) have no official API, so saylent reads them
-- through a bring-your-own SERP-data provider. Today that is SerpApi, keyed by
-- SERPAPI_API_KEY. The app resolves that key exactly like the four model-API
-- keys (src/lib/provider-settings.ts: env wins, else the encrypted console
-- store, else absent), so an operator can add it from /admin/providers with no
-- redeploy.
--
-- WHY THIS MIGRATION EXISTS
--   0042's two writers hard-code the provider allow-list
--   ('openai','anthropic','gemini','perplexity') and raise on anything else, so
--   saving a SerpApi key from the console would fail with "unknown provider
--   serpapi". The readers (get_provider_key / get_provider_keys /
--   provider_settings_state) are provider-agnostic and need no change.
--
-- WHAT CHANGES, AND WHAT DOES NOT
--   set_provider_key and remove_provider_key are recreated with 'serpapi' added
--   to the allow-list. Everything else is 0042 verbatim: the same signatures, the
--   same SECURITY DEFINER with the same pinned search_path (public, extensions
--   for the writer that calls pgp_sym_encrypt; public for the remover), the same
--   APP_SECRET length floor, the same state-change-plus-audit_log write in one
--   transaction, and the same audit wording (the key and its ciphertext are
--   never written to the audit entry). `create or replace` keeps the function
--   OIDs, but the EXECUTE privileges are re-asserted below exactly as 0042 set
--   them, so this file is correct on its own however the function was created.
--
-- Keep the allow-list in step with src/lib/provider-settings.ts PROVIDER_META
-- (provider-settings.test.ts reads this file and fails if they drift).

create or replace function public.set_provider_key(
  p_actor uuid, p_provider text, p_key text, p_secret text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_provider not in ('openai','anthropic','gemini','perplexity','serpapi') then
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
  -- the single row is created by 0042; re-assert it so a writer can never
  -- silently update zero rows.
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

create or replace function public.remove_provider_key(p_actor uuid, p_provider text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_provider not in ('openai','anthropic','gemini','perplexity','serpapi') then
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

comment on function public.set_provider_key(uuid,text,text,text) is
  'Encrypt-and-store one provider key + its audit_log row, in one transaction. Neither the key nor its ciphertext is ever written to the audit entry. Providers: openai, anthropic, gemini, perplexity, serpapi (0045).';

-- brands.engines (0029) now also holds answer-surface ids. The column is
-- unconstrained text[], so only its description changes.
comment on column public.brands.engines is
  'ENGINE-SELECT: owner''s current answer-source selection. NULL = the default four model APIs (chatgpt/claude/gemini/perplexity). May also list the opt-in answer surfaces google_ai_overview / google_ai_mode / copilot (read through SerpApi, 0045). Floored at 2. The FROZEN set the pipeline asks lives in question_set.engines, not here — see 0029 header.';
