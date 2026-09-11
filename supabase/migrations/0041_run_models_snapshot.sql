-- Run reproducibility snapshot, part 2 (0034 stamped question_set + brand_model;
-- this stamps the last two pieces a run needs to fully explain itself later):
--   * models         — the role→model map this run ACTUALLY used (modelsUsed() in
--                      packages/engine/src/run-audit.ts). Without it, re-reading an
--                      old run after MODEL_* env overrides or registry defaults
--                      change silently mislabels which model produced which answer
--                      (the export route used to recompute modelsUsed() fresh at
--                      export time, which is only correct for the CURRENT build).
--   * template_set_version — the questions.ts TEMPLATE_SET_VERSION the frozen
--                      question set was generated from. Same staleness problem: the
--                      export route used to read the CURRENT build's constant.
--
-- Both additive + nullable: old runs read NULL and every existing read path (the
-- get_dossier RPC's `to_jsonb(r) - …`, 0039) picks the new columns up automatically
-- with no RPC change needed. template_set_version is `text` (not int) so a future
-- non-numeric scheme (e.g. a semver-shaped template set) never needs another column.
--
-- WRITE PATH: stamped by src/inngest/functions.ts right after runAuditPipeline
-- returns its RunResult, via src/lib/db.ts stampRunSnapshot(runId, { models,
-- templateSetVersion }) (best-effort, same contract as writeRunHealth/writeRunSnapshot
-- — never fails the run).
-- READ PATH: src/app/api/runs/[id]/export/route.ts prefers these persisted columns
-- over recomputing modelsUsed()/TEMPLATE_SET_VERSION when they are present.

alter table public.runs
  add column if not exists models jsonb,
  add column if not exists template_set_version text;

comment on column public.runs.models is
  'Reproducibility: role -> model id map this run actually used (modelsUsed(), stamped at finish by db.ts stampRunSnapshot). NULL on pre-0041 runs and on failed runs; the export route falls back to recomputing modelsUsed() from the CURRENT build when NULL.';
comment on column public.runs.template_set_version is
  'Reproducibility: questions.ts TEMPLATE_SET_VERSION this run''s frozen question set was generated from, stamped at finish (text, not int -- a future non-numeric template-set scheme never needs another column). NULL on pre-0041 runs; the export route falls back to the CURRENT build''s TEMPLATE_SET_VERSION constant when NULL.';
