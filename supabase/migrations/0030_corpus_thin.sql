-- Crawler v2 (TODO "Crawler v2") — honest thin/SPA flag on cited corpus pages.
-- `thin` = the page's extracted text is under the word threshold WHILE the raw
-- HTML is a JS shell (empty React/Vue/Angular mount root) or script-heavy, i.e.
-- the page renders client-side and answer engines likely can't read it. Computed
-- in src/engine/crawl.ts classifyThin, set in buildCorpus, written by the admin
-- client only (corpus_pages takes no direct user writes since 0025 — no grant
-- needed). Flows to the UI automatically: get_dossier (0014/0021) emits corpus
-- rows via to_jsonb(c), so the new column appears in the dossier payload with no
-- RPC change. NOT NULL DEFAULT false — old rows read as not-thin.
alter table public.corpus_pages
  add column if not exists thin boolean not null default false;

comment on column public.corpus_pages.thin is
  'Crawler v2: true when the cited page is a thin/SPA JS shell (little static text + script-heavy or empty mount root) — surfaced in the PageDrawer as "answer engines may not read it". See src/engine/crawl.ts classifyThin.';
