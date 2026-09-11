-- In-app notifications. A durable, realtime-backed inbox of
-- run-lifecycle events (audit_ready | verify_ready | run_failed) written by the
-- Inngest engine via the service role and read by the owner in the app.
--
-- Writes are service-role ONLY: RLS + column-restricted grants block the
-- browser. The owner may SELECT own rows and UPDATE only seen_at/read_at (mark
-- seen/read) — never INSERT/DELETE and never the content columns. The unique
-- (run_id, type) index makes the engine's emit idempotent: the finish step is
-- retryable, and an ignoreDuplicates upsert on that key collapses re-emits to
-- one row. Style mirrors 0016/0020 (revoke-all-then-grant column model), 0017
-- (initplan-wrapped auth.uid(), `to authenticated`), and 0008 (realtime pub).

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  run_id uuid references public.runs(id) on delete cascade,
  type text not null check (type in ('audit_ready','verify_ready','run_failed')),
  title text not null,
  href text not null,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  read_at timestamptz
);

-- idempotent emit: one notification per (run, type). The engine upserts with
-- ignoreDuplicates on this key so a retried step never double-notifies.
create unique index notifications_run_type_idx on public.notifications (run_id, type);
-- inbox listing: newest first, per user.
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
-- unseen-badge count: partial index over just the unseen rows.
create index notifications_user_unseen_idx on public.notifications (user_id) where seen_at is null;

alter table public.notifications enable row level security;

-- owner may READ own rows.
create policy "own notifications read" on public.notifications for select to authenticated
  using ((select auth.uid()) = user_id);
-- owner may mark own rows seen/read. The column grants below restrict writes to
-- seen_at/read_at; WITH CHECK keeps an update from re-homing a row to another
-- user. No INSERT/DELETE policy — those are the engine's (service-role) job.
create policy "own notifications update" on public.notifications for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- column-restricted writes (revoke-all-then-grant, per 0016): read every column,
-- update ONLY seen_at/read_at. `revoke all` also strips any default INSERT/DELETE/
-- TRUNCATE so the browser cannot forge or delete notifications.
revoke all on public.notifications from authenticated, anon;
grant select on public.notifications to authenticated;
grant update (seen_at, read_at) on public.notifications to authenticated;

-- realtime: the app subscribes for a live inbox + unseen badge (cf. 0008 for runs).
alter publication supabase_realtime add table public.notifications;
