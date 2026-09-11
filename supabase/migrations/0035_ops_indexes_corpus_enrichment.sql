-- Ops index + corpus enrichment columns.
--
-- A. runs(status, created_at desc) — the operator console (/admin/runs) and the
--    crons scan "the newest queued/running/failed runs" constantly; today that's a
--    filter on status + an ORDER BY created_at with no covering index (runs_brand_created
--    from 0013 leads with brand_id, so it doesn't serve a status-wide scan). This
--    index makes the status-filtered, newest-first sweep an index range scan.
--
-- B. corpus_pages enrichment columns the engine will populate (additive,
--    nullable — old rows read NULL, every existing read path untouched; the
--    columns flow into the dossier automatically via get_dossier's to_jsonb(c)).
--      * page_date — the page's own published/modified date when detectable
--        (article:published_time / dateModified / <time> / sitemap lastmod). Lets a
--        fix say "this cited page is 3 years stale" instead of guessing.
--      * contact — outlet contact signals scraped from a cited third-party page
--        ({ mailto?, form_url?, claim_url? }) so an outreach fix can name HOW to
--        reach the outlet, not just which one.

create index if not exists runs_status_created on public.runs (status, created_at desc);

alter table public.corpus_pages
  add column if not exists page_date timestamptz,
  add column if not exists contact jsonb;

comment on column public.corpus_pages.page_date is
  'Enrichment: the cited page''s own published/modified timestamp when detectable (article:published_time / schema dateModified / <time datetime> / sitemap lastmod). NULL when no reliable date signal — never a fabricated date.';
comment on column public.corpus_pages.contact is
  'Enrichment: outlet contact signals detected on a cited third-party page — { mailto?, form_url?, claim_url? } — so an outreach fix can say how to reach the outlet. NULL when none found.';
