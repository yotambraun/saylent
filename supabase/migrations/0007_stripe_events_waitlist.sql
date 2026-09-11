-- stripe_events (idempotency + audit trail) + waitlist
create table public.stripe_events (
  id text primary key,               -- Stripe event id: natural idempotency
  type text not null, payload jsonb not null,
  processed_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security; -- service-role only

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text default 'demo',                  -- which CTA captured it
  created_at timestamptz not null default now()
);
alter table public.waitlist enable row level security; -- no policies: writes
-- happen only via /api/waitlist with service role (rate-limit: 5/min per IP
-- in-route; validate email with zod; upsert on conflict do nothing).
