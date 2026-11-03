-- AI crawler analytics in the app: the AGGREGATES of an access log an owner
-- uploads on the brand page, never the log.
--
-- The upload route (src/app/api/brands/[id]/crawlers/route.ts) streams the file
-- through the same engine function as `saylent crawlers`
-- (packages/engine/src/crawler-analytics.ts) and stores only its CrawlerReport:
-- per-bot counts, the top pages, problem rows with at most three log lines each
-- (client IP redacted to two octets, query strings cut), and the window. The
-- raw log is never written to disk or to this database. RETENTION: the route
-- keeps the newest 12 reports per brand and deletes older ones; the owner can
-- delete any report from the brand page; a brand's reports go with the brand
-- (on delete cascade).
--
-- RLS / GRANTS (style of 0016/0020/0023/0026: revoke-all-then-grant):
--   * the owner may READ and DELETE their own rows ((select auth.uid()) = user_id,
--     initplan-wrapped as in 0015/0017);
--   * nobody but the service role may INSERT or UPDATE: the upload route checks
--     brand ownership on the owner's RLS client, then writes with the service
--     client, so a browser can never forge a report;
--   * anon gets nothing.
-- The four scalar columns duplicate the report's totals so the brand page and
-- the alert rule (packages/report/src/alerts.ts, crawler errors spike) read a
-- row without parsing the jsonb.

create table if not exists public.crawler_reports (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  source_name text not null check (char_length(source_name) between 1 and 200),
  window_from timestamptz,
  window_to timestamptz,
  ai_bot_hits integer not null default 0 check (ai_bot_hits >= 0),
  ai_errors integer not null default 0 check (ai_errors >= 0),
  ai_blocked integer not null default 0 check (ai_blocked >= 0),
  report jsonb not null check (jsonb_typeof(report) = 'object'),
  constraint crawler_reports_report_size check (pg_column_size(report) < 4000000)
);

create index if not exists crawler_reports_brand_created_idx
  on public.crawler_reports (brand_id, created_at desc);
create index if not exists crawler_reports_user_idx
  on public.crawler_reports (user_id);

alter table public.crawler_reports enable row level security;

drop policy if exists "own crawler reports read" on public.crawler_reports;
create policy "own crawler reports read" on public.crawler_reports for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "own crawler reports delete" on public.crawler_reports;
create policy "own crawler reports delete" on public.crawler_reports for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.crawler_reports from authenticated, anon;
grant select, delete on public.crawler_reports to authenticated;

comment on table public.crawler_reports is
  'AI crawler analytics (0046): the aggregate CrawlerReport of an uploaded access log, never the log. IPs redacted, query strings dropped, newest 12 per brand kept. Owner read/delete; service-role insert only.';
