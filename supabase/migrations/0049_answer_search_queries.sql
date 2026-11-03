-- Query fan-out as receipts: the web searches an answer engine ran before it
-- answered, as its own API response reports them (ChatGPT web_search_call
-- action queries, Claude server_tool_use web_search inputs, Gemini
-- groundingMetadata.webSearchQueries; see packages/engine/src/search-queries.ts).
-- Read from responses the pipeline already receives: no extra request, no cost.
--
-- MEANING
--   * text[] of the queries for that draw, in the order the engine ran them.
--   * '{}' (empty): the engine reports its searches and ran none.
--   * NULL: not reported. Perplexity's API and the SerpApi surfaces do not
--     expose their queries, and every row written before this migration is NULL.
--   answers.search_queries is the representative draw's list (the same draw
--   whose raw_text and citations the row carries); answer_samples keeps each
--   draw's own.
--
-- RLS / GRANTS: unchanged. Both tables already grant the owner SELECT on the
-- whole row ("own answers", "own answer_samples") and nobody but the service
-- role writes them (0025, 0033); a new column inherits exactly that. get_dossier
-- (0039) builds answers with to_jsonb(a), so the column reaches the report
-- without a function change.
--
-- Safe to apply on a live database: two nullable columns, no default rewrite,
-- no backfill. The app writes the column only after this is applied; until
-- then src/lib/db.ts retries the insert without it, so runs keep working.
alter table public.answers add column if not exists search_queries text[];
alter table public.answer_samples add column if not exists search_queries text[];

comment on column public.answers.search_queries is
  'Web searches the engine ran for this answer (representative draw), as its API reported them. Empty = reported, none ran. NULL = not reported (Perplexity, SerpApi surfaces, rows before 0049).';
comment on column public.answer_samples.search_queries is
  'Web searches the engine ran for this draw, as its API reported them. Empty = reported, none ran. NULL = not reported.';
