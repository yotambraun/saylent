-- User account page. A user-editable display name on their profile.
-- Follows 0016's column-grant model: 0016 revoked the blanket UPDATE on
-- public.profiles and re-granted it per-column (email_reports only, the sole
-- column a user legitimately self-edits). display_name is likewise self-edited,
-- so grant UPDATE on JUST that column back to `authenticated`.
-- GRANT UPDATE(col) is additive per-column, so this joins the existing
-- email_reports grant without touching plan/audit_purchases/stripe_customer_id,
-- which remain service-role-only. The "own profile update" RLS policy (0016)
-- already scopes writes to the row owner, so no policy change is needed.

alter table public.profiles add column display_name text;

grant update (display_name) on public.profiles to authenticated;

comment on column public.profiles.display_name is
  'User-chosen display name. Self-writable (0016 column grant + own-profile RLS); never billing/role.';
