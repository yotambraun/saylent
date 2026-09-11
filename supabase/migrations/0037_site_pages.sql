-- Own-site coverage snapshot for the dossier's "Your site vs the
-- buyer questions" map (report-intel.ts ownSiteCoverage / SitePageMeta).
--
-- WHY: the pipeline crawls the brand's own site (src/engine/crawl.ts crawlSite)
-- but the crawl output is consumed transiently (brand model + domain checks) and
-- then discarded. The dossier had no way to show which of the brand's OWN pages
-- exist, how fresh they are, or which buyer questions their site has no page for.
--
-- SHAPE: jsonb array of META ONLY — never page text (Inngest caps step output at
-- 4MB; full text through the run row is both wasteful and pointless here):
--   [{ url, title, date? }]  -- date = sitemap <lastmod> ISO when the crawler
--                               discovered the page via the sitemap; capped at 25.
-- The write goes through report-intel.sitePagesMeta() (pure + unit-tested) from
-- the pipeline crawl step, so the stored shape stays tested in one place.
--
-- READ PATH: get_dossier returns `to_jsonb(r) - 'user_id'`, so this column rides
-- along in the existing dossier payload with NO RPC change — the view reads
-- run.site_pages directly. Additive + nullable: old runs read NULL (snapshot not
-- captured), so ownSiteCoverage() returns null and the panel is absent entirely.

alter table public.runs add column if not exists site_pages jsonb;

comment on column public.runs.site_pages is
  'Own-site crawl META for the dossier coverage map — [{ url, title, date? }], date = sitemap <lastmod>, capped at 25, NEVER page text. Written by the Inngest crawl step via report-intel.sitePagesMeta(). Rides along in get_dossier''s to_jsonb(r). NULL on older runs.';
