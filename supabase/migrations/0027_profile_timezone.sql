-- Timezone on the profile. Today only
-- the client-side greeting knows the user's local time; scheduled server-side jobs
-- (weekly-verify, monthly-audit, dunning email send-time) need a stored, timezone-aware
-- anchor to avoid the Monday-9am thundering herd.
-- This column is that source of truth. Those jobs are NOT built here — they will
-- read profiles.timezone when they land.
--
-- Follows the 0016 column-guard model exactly (same as 0019 display_name):
-- 0016 revoked the blanket UPDATE on public.profiles and re-grants it per-column.
-- timezone is user-self-edited (a Preferences control), so grant UPDATE on JUST
-- that column back to `authenticated`. GRANT UPDATE(col) is additive, so this
-- joins the existing email_reports + display_name grants without touching
-- plan/audit_purchases/stripe_customer_id (service-role-only). The "own profile
-- update" RLS policy (0016) already scopes writes to the row owner.
--
-- Nullable, no default: null means "unset" → callers fall back to UTC (server)
-- or the browser-detected zone (client greeting). Stores an IANA name (e.g.
-- "Europe/Berlin"), validated in the server action before write.

alter table public.profiles add column timezone text;

grant update (timezone) on public.profiles to authenticated;

comment on column public.profiles.timezone is
  'IANA time zone (e.g. "Europe/Berlin"), user-self-set. Self-writable (0016 column grant + own-profile RLS). Null = unset → UTC fallback. Consumed by the scheduled digest crons for send-time; never billing/role.';
