-- First-user admin bootstrap: a fresh self-hosted deployment has no operator console access at
-- all until someone runs grant-admin.ts by hand against the DB. Recommended
-- default instead: the FIRST profile ever created on a deployment becomes admin
-- automatically; every later signup is a normal 'user' row. grant-admin.ts (0020)
-- stays as-is for promoting additional operators afterwards — this migration only
-- changes what the very first row gets.
--
-- MECHANISM: a BEFORE INSERT trigger on public.profiles (not a change to 0001's
-- handle_new_user — migrations are never edited after the fact). It overrides
-- NEW.role to 'admin' when no existing row already has role='admin'.
--
-- RACE SAFETY: two signups landing at the same instant both see "0 admins exist"
-- under READ COMMITTED unless serialized. The fix is a session-scoped Postgres
-- advisory lock (pg_advisory_xact_lock), NOT a unique index on role='admin':
--   * A unique partial index (e.g. `unique (true) where role='admin'`) would cap
--     the WHOLE DEPLOYMENT at exactly one admin, forever — but grant-admin.ts is
--     explicitly kept for promoting later operators by hand, i.e.
--     promoting a second/third admin by hand must keep working. A hard uniqueness
--     constraint on the admin bit would break that.
--   * pg_advisory_xact_lock(key) only serializes the CHECK-THEN-SET inside this
--     trigger — it holds no opinion about how many admin rows may exist later. Two
--     concurrent inserts block on the same lock key; the first to acquire it commits
--     its 'admin' row, the second then re-checks (now sees the first admin) and
--     stays 'user'. The lock auto-releases at transaction end (xact variant), so it
--     never needs manual cleanup and cannot deadlock across unrelated transactions.
-- security definer + search_path pin follows the 0010/0017/0020 pattern (the
-- function must read public.profiles regardless of the inserting role, e.g. the
-- anon/authenticated caller behind handle_new_user's own security definer insert).
create function public.first_user_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('saylent_first_admin')::bigint);
  if not exists (select 1 from public.profiles where role = 'admin') then
    new.role := 'admin';
  end if;
  return new;
end $$;

-- idempotent (re-running the migration must not error): drop-then-create.
drop trigger if exists first_user_admin_trigger on public.profiles;
create trigger first_user_admin_trigger before insert on public.profiles
  for each row execute function public.first_user_admin();

comment on function public.first_user_admin() is
  'Bootstrap: promotes the very first public.profiles row to role=''admin'' (race-safe via pg_advisory_xact_lock; see migration 0040 header). Later admins are granted by hand via scripts/grant-admin.ts.';
