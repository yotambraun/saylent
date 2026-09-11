-- Persist the brand-model confidence signal on the brand.
--
-- BrandModel.confidence ('ok' | 'low') is computed by the pipeline's brand-model
-- step (LLM self-report + the deterministic brandModelConfidence() heuristic:
-- thin/ambiguous site text, no concrete products/value_props, or generic-fallback
-- fields). Until now it lived only in the transient in-memory model and the
-- per-run runs.brand_model snapshot (migration 0034). This column keeps the LIVE
-- signal on the brand so the app can flag "we couldn't model this brand reliably"
-- without re-reading a run.
--
-- Additive + backfilled to 'ok' so every existing brand reads a valid value; the
-- pipeline writes model.confidence (?? 'ok') on each audit's brand-model step.
alter table public.brands
  add column if not exists brand_model_confidence text not null default 'ok';

comment on column public.brands.brand_model_confidence is
  'Latest audit''s BrandModel.confidence (ok|low): low = the crawled site was too thin/ambiguous to model the brand reliably. Written by the pipeline brand-model step (model.confidence ?? ''ok''). Defaults ''ok'' for older brands.';
