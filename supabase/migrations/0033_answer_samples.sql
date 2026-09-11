-- Answer sampling schema (3x sampling evidence).
--
-- CONTRACT (read before touching either table):
--   * public.answers stays the CANONICAL surface: exactly ONE row per
--     (run_id, qid, engine). Every existing read path — get_dossier (0014/0021),
--     scoring, run-health, the dossier UI — reads answers and MUST keep working
--     unchanged. Its raw_text is the REPRESENTATIVE sample and its verdict is the
--     MAJORITY VOTE across the samples (chosen by the scorer).
--   * public.answer_samples is the EVIDENCE + VARIANCE ledger: the individual
--     draws behind that canonical row. When a scored question is asked N times
--     (3x on scored questions), each draw lands here as one row (sample_idx
--     0..N-1) with its own raw_text / citations / verdict / usage. This is what
--     lets us show "recommended in 2 of 3 runs" and audit verdict stability —
--     WITHOUT changing the one-row-per-(run,qid,engine) shape everything else
--     depends on.
--
-- So: answers = the settled result; answer_samples = how we got there. A missing
-- answer_samples table (old runs) simply means "no per-sample evidence retained" —
-- never a broken read, because nothing canonical lives here.
--
-- POSTURE: owner-read / service-write, same as citations (0032) and corpus_pages —
-- written only by the pipeline via db.ts saveAnswerSamples (service role).

create table public.answer_samples (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  qid text not null,
  engine text not null,
  sample_idx int not null,           -- 0-based draw index within (run,qid,engine)
  raw_text text not null default '',
  citations jsonb not null default '[]',
  verdict jsonb,                     -- this draw's verdict (same shape as answers.verdict)
  usage jsonb,                       -- this draw's provider usage (tokens + searches)
  created_at timestamptz not null default now()
);

-- Pull every sample behind a canonical answer in one indexed range scan.
create index answer_samples_run_qid_engine on public.answer_samples (run_id, qid, engine);

alter table public.answer_samples enable row level security;
-- Owner may READ their own samples; NO write policy (service-role-only writes).
create policy "own answer_samples" on public.answer_samples for select to authenticated
  using ((select auth.uid()) = user_id);
revoke insert, update, delete, truncate on public.answer_samples from authenticated, anon;

comment on table public.answer_samples is
  'Per-sample evidence + variance behind the canonical answers row. answers stays one-row-per-(run,qid,engine) (representative raw_text + majority-voted verdict); each draw of a scored question lands here (sample_idx 0..N-1). Service-role writes only (db.ts saveAnswerSamples).';
comment on column public.answer_samples.sample_idx is
  '0-based draw index within (run_id, qid, engine). N draws → sample_idx 0..N-1; the canonical answers row is their majority vote / representative pick.';
