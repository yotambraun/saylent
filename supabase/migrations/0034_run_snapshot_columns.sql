-- Run reproducibility snapshot.
--
-- WHY: a run's history is not actually reproducible today. Two gaps:
--   * question_set — the frozen questions live MUTABLY on brands.question_set;
--     editing questions / engines rewrites that envelope in place, so an old run
--     can no longer say exactly which questions it asked (it re-derives them from
--     its answer rows, which loses the version + engines envelope).
--   * brand model — the BrandModel the pipeline built (icp, competitors, aliases,
--     value_props, …) is never versioned at all; a later re-audit rebuilds it and
--     the old run's basis is gone.
--
-- FIX: stamp both onto the run at creation / build time so each run carries its
-- own immutable basis. Additive, nullable — old runs read NULL (basis not
-- captured), every existing read path is untouched.
--
-- WRITE PATH: the run row is INSERTed in src/lib/runs.ts createRun (NOT db.ts), so
-- these columns are filled by db.ts stampRunSnapshot(runId, {questionSet, brandModel})
-- — a partial writer the createRun path stamps question_set with, and the pipeline
-- brand-model step stamps brand_model with. This migration only adds the columns;
-- wiring the calls belongs to the runs.ts / pipeline owners.

alter table public.runs
  add column if not exists question_set jsonb,
  add column if not exists brand_model jsonb;

comment on column public.runs.question_set is
  'Reproducibility: the frozen question envelope this run actually asked — { questions, version, engines } — stamped at createRun time (db.ts stampRunSnapshot). Immutable per run; brands.question_set is the live, mutable copy. NULL on older runs.';
comment on column public.runs.brand_model is
  'Reproducibility: the BrandModel (icp, aliases, competitors, value_props, …) the pipeline built for this run, stamped at build time (db.ts stampRunSnapshot). Versions the model per run; brands stays the live copy. NULL on older runs.';
