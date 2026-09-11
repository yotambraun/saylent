-- Per-brand, frozen answer-engine
-- selection. Only the FOUR *answer* engines (chatgpt/claude/gemini/perplexity) are
-- user-selectable; the judge / brand-model / drafter "brain" stays on the fixed Claude
-- set (src/lib/models.ts) — never user-configurable (cross-family judging integrity +
-- constant quality).
--
-- STORAGE: `engines` is the brand owner's *current selection*. NULL = the default "we
-- ask all four" (the sales claim). A non-empty array is a Pro-only narrowed subset
-- (>= ENGINE_FLOOR, src/engine/engines.ts). Non-pro brands stay NULL.
--
-- FREEZE / RE-BASELINE (the methodology guarantee — a verify must NEVER compare
-- mismatched engine sets):
--   * The engine set the pipeline actually asks is FROZEN INSIDE the question_set
--     envelope, alongside the frozen questions: question_set = { questions, version,
--     engines }. The audit/verify honors question_set.engines — NEVER this live column
--     (src/inngest/functions.ts frozenEngines()). So even a raw owner UPDATE to this
--     column (brands is user-writable, 0025) cannot corrupt an existing baseline's
--     verify: the run ignores the column and reuses the frozen envelope.
--   * Changing the selection goes through updateBrand (src/app/app/settings/actions.ts),
--     which treats an engine-set change EXACTLY like a question change: it clears
--     question_set (→ NULL) and bumps question_set_version. A verify requires a non-null
--     frozen set, so it can only run AFTER a fresh audit re-freezes questions + engines
--     TOGETHER — that fresh audit becomes the new baseline. This is the same re-baseline
--     machinery editing the questions already uses; no parallel engines_version needed.
--
-- GRANTS: none added. brands was intentionally LEFT user-writable in 0025 (createBrand /
-- updateBrand run on the owner's RLS client), so `authenticated` already holds the blanket
-- UPDATE that lets the owner set this column. The comparability guarantee comes from the
-- run reading the frozen envelope, not from locking the column.

alter table public.brands
  add column if not exists engines text[] default null;

comment on column public.brands.engines is
  'ENGINE-SELECT: owner''s current answer-engine selection (subset of chatgpt/claude/gemini/perplexity). NULL = default all four. Pro-only. The FROZEN set the pipeline asks lives in question_set.engines, not here — see 0029 header.';
