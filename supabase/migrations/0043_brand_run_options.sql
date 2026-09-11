-- App/CLI parity for run control.
--
-- The CLI already lets an operator see the generated buyer questions BEFORE
-- spending (`saylent questions`), edit them in a questions.json, and then pick
-- samples / engines / locale / skipped stages on the `saylent audit` command
-- line. The app had none of that: the set froze unseen and the run took every
-- default. These two columns are the whole storage story for closing that gap.
--
-- brands.run_options — the DRAFT. What the owner chose on
--   /app/brand/<id>/questions, before any run exists: the edited question rows,
--   run-level samples, the answer-engine subset, a locale, and which stages to
--   skip. It is deliberately NOT the frozen set: freezing still happens exactly
--   where it always has, at run time, inside the pipeline's "questions" step
--   (question_set / question_set_version, migration 0002). So a draft can be
--   edited, reset, or abandoned as many times as the owner likes and no baseline
--   moves until an audit actually runs. When the draft differs from the set the
--   brand has frozen, the server action clears question_set and bumps
--   question_set_version — the SAME visible re-baseline a question-affecting
--   brand edit already performs (settings/actions.ts updateBrand, 0029 header) —
--   so no verify can ever compare two different question sets.
--
-- runs.run_options — the RECEIPT. The exact option blob the run was created
--   with, stamped by createRun (src/lib/runs.ts, the one run-creation path).
--   The draft on the brand keeps changing; this records what THIS run was told
--   to do, which is what makes a past run reproducible and a cost explainable.
--
-- SHAPE (validated in src/lib/question-options.ts, never trusted from the DB):
--   {
--     "questions": [{"id":"q01","type":"category","text":"...",
--                    "source":"template|user","samples":1-5}],   -- optional
--     "samples":  1-5,                                            -- optional
--     "engines":  ["chatgpt","claude"],                           -- optional
--     "locale":   "pt-BR",                                        -- optional
--     "skip":     {"drafts":true,"corpus":true,"gates":true},     -- optional
--     "updated_at": "2026-09-10T00:00:00.000Z"
--   }
-- Every field is optional and an absent field means "the default", exactly like
-- an omitted CLI flag. jsonb (not json) so the shape is normalized on write and
-- readable with the -> operators; no GIN index, because both columns are only
-- ever read by primary key (brands.id) or by run id, and a partial jsonb index
-- would cost writes to buy nothing.
--
-- RLS / GRANTS:
--   * brands was intentionally LEFT user-writable in 0025 (createBrand /
--     updateBrand run on the owner's RLS client), and the "own brands" policy
--     from 0002 is `for all`, so the owner — and only the owner — can already
--     write this new column. No policy and no grant is added here: adding one
--     would widen access, not narrow it.
--   * runs had every write REVOKED from `authenticated` in 0025, with a single
--     column re-granted (share_token). runs.run_options is therefore
--     service-role-only by construction, which is exactly right: createRun
--     stamps it, and a signed-in user must never be able to rewrite the receipt
--     of a run that already happened.
--
-- Both statements are ADD COLUMN with a NULL default: no table rewrite, no
-- lock beyond a brief ACCESS EXCLUSIVE for the catalog update, safe on a live
-- database. The CHECK constraints are validated against zero rows (every
-- existing row has NULL in a column that did not exist a moment ago), so they
-- also take no scan.

alter table public.brands
  add column if not exists run_options jsonb;

alter table public.brands
  drop constraint if exists brands_run_options_is_object;
alter table public.brands
  add constraint brands_run_options_is_object
  check (run_options is null or jsonb_typeof(run_options) = 'object');

comment on column public.brands.run_options is
  'T3 App/CLI parity: the owner''s DRAFT run controls from /app/brand/<id>/questions — {questions[],samples,engines,locale,skip,updated_at}. Not the frozen set: question_set still freezes at run time. Editing the questions here re-baselines (clears question_set, bumps question_set_version). Owner-writable via the 0002 "own brands" policy; see the 0043 header.';

alter table public.runs
  add column if not exists run_options jsonb;

alter table public.runs
  drop constraint if exists runs_run_options_is_object;
alter table public.runs
  add constraint runs_run_options_is_object
  check (run_options is null or jsonb_typeof(run_options) = 'object');

comment on column public.runs.run_options is
  'T3 App/CLI parity: the exact option blob this run was created with (createRun stamps it). Service-role only — 0025 revoked every user write on runs except share_token — so the receipt of a finished run cannot be rewritten.';
