-- Alerts & digest: per-brand delivery settings, and the delivery log that
-- dedupes and rate-limits them.
--
-- brand_alerts — one row per brand. WHEN: after every finished run of the
--   brand (on_run) and/or a weekly digest (weekly_digest, Mondays 09:30 UTC).
--   WHERE: email to the owner through the deployment's own email setup
--   (src/lib/email.ts), a Slack incoming webhook, and/or a generic
--   webhook signed with an HMAC secret. The two webhook URLs and the secret are
--   CREDENTIALS (anyone holding a Slack webhook URL can post to the channel), so
--   they are stored sealed (AES-256-GCM under a key derived from APP_SECRET,
--   src/lib/secret-box.ts) and never granted to the browser: the owner's
--   client can read only the non-secret columns, and every write goes through a
--   server action that checks brand ownership on the owner's RLS client first,
--   then writes with the service client.
--
-- alert_deliveries — one row per delivered alert and channel: the payload's
--   dedupe key (saylent.alert/v1 `id`), the channel, the status and a short,
--   URL-free error. The key is unique among SENT rows, so a retried Inngest step
--   can never send the same alert twice while a failed one can be retried; the
--   hourly rate limit counts sent rows. No payload, URL or secret is stored.
--
-- RLS / GRANTS follow 0023/0026: revoke-all-then-grant, initplan-wrapped
-- auth.uid(), service-role writes only.

create table if not exists public.brand_alerts (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  on_run boolean not null default true,
  weekly_digest boolean not null default false,
  email boolean not null default false,
  slack_url_sealed text,
  webhook_url_sealed text,
  webhook_secret_sealed text,
  updated_at timestamptz not null default now()
);

create index if not exists brand_alerts_user_idx on public.brand_alerts (user_id);
create index if not exists brand_alerts_digest_idx on public.brand_alerts (weekly_digest) where weekly_digest;

alter table public.brand_alerts enable row level security;

drop policy if exists "own brand alerts read" on public.brand_alerts;
create policy "own brand alerts read" on public.brand_alerts for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.brand_alerts from authenticated, anon;
-- the sealed columns are deliberately absent from this grant
grant select (brand_id, user_id, on_run, weekly_digest, email, updated_at) on public.brand_alerts to authenticated;

comment on table public.brand_alerts is
  'Alerts & digest settings per brand (0047). Webhook URLs and the HMAC secret are sealed with APP_SECRET and never granted to the browser; writes are service-role only, after an ownership check.';

create table if not exists public.alert_deliveries (
  id bigint generated always as identity primary key,
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  run_id uuid references public.runs(id) on delete set null,
  key text not null check (char_length(key) <= 120),
  channel text not null check (channel in ('webhook', 'slack', 'email')),
  kind text not null check (kind in ('run.changed', 'digest.weekly', 'test')),
  status text not null check (status in ('sent', 'failed')),
  error text check (error is null or char_length(error) <= 300),
  created_at timestamptz not null default now()
);

create unique index if not exists alert_deliveries_sent_key_idx on public.alert_deliveries (key) where status = 'sent';
create index if not exists alert_deliveries_brand_created_idx on public.alert_deliveries (brand_id, created_at desc);

alter table public.alert_deliveries enable row level security;

drop policy if exists "own alert deliveries read" on public.alert_deliveries;
create policy "own alert deliveries read" on public.alert_deliveries for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.alert_deliveries from authenticated, anon;
grant select on public.alert_deliveries to authenticated;

comment on table public.alert_deliveries is
  'Alerts & digest delivery log (0047): dedupe key, channel, status and a URL-free error per sent alert. No payload, URL or secret. Service-role writes only.';
