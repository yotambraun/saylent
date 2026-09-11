-- Normalized `citations` table.
--
-- WHY: today every citation lives buried inside answers.citations (a jsonb array
-- per (run,qid,engine) row). That's fine for the receipt drawer, but it makes the
-- host-level questions the engine needs — "which outlets cite this brand, how
-- often, across which engines?" — a full-table jsonb unnest every time. This is the
-- flattened, indexable projection: ONE ROW PER CITATION PER ANSWER, so host/outlet
-- aggregation is an ordinary indexed GROUP BY.
--
-- RELATIONSHIP TO answers.citations: answers.citations stays the CANONICAL nested
-- record the dossier reads (unchanged). `citations` is a DERIVED denormalization —
-- populated forward by the pipeline (db.ts saveCitations)
-- and backward by scripts/backfill-citations.ts for historical runs. Never written
-- by a browser.
--
-- POSTURE: copies corpus_pages' net posture (0005 + 0015 + 0025) — owner may SELECT
-- their own rows; ALL writes go through the service role (createDbWriter), which
-- bypasses RLS and role grants. Expressed the 0031 way: a SELECT-only owner policy
-- plus a blanket write revoke (no user write path exists at all).

create table public.citations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  qid text not null,                 -- the scored question this citation answered
  engine text not null,              -- chatgpt|claude|gemini|perplexity (answer engine)
  url text not null,                 -- the citation URL exactly as the engine returned it
  norm_url text not null,            -- normUrl(url): scheme/host lowered, fragment + tracking params stripped
  host text not null,                -- aggregation key: the source host (www-stripped, archive/redirect-unwrapped)
  position int,                      -- 0-based order within the answer's citation list (null when unknown)
  created_at timestamptz not null default now()
);

-- Hot read paths: by run (dossier/per-run), and host rollups per brand + globally.
create index citations_run on public.citations (run_id);
create index citations_brand_host on public.citations (brand_id, host);
create index citations_host on public.citations (host);

alter table public.citations enable row level security;
-- Owner may READ their own citations; NO write policy (service-role-only writes).
create policy "own citations" on public.citations for select to authenticated
  using ((select auth.uid()) = user_id);
revoke insert, update, delete, truncate on public.citations from authenticated, anon;

comment on table public.citations is
  'Flattened one-row-per-citation projection of answers.citations for host/outlet aggregation. DERIVED (never a browser write): populated forward by db.ts saveCitations and backward by scripts/backfill-citations.ts. answers.citations remains the canonical nested record.';
comment on column public.citations.norm_url is
  'normUrl(url) — canonical form (scheme/host lowercased, fragment + utm_/ref/fbclid/gclid stripped, trailing slash trimmed). Mirrors src/engine/util.ts normUrl (copied pure in src/lib/citation-url.ts).';
comment on column public.citations.host is
  'Aggregation key: the real source host, www-stripped, with web.archive.org wrappers and Gemini vertexaisearch grounding-redirects unwrapped (redirect destination taken from the citation title, which Gemini fills with the source domain). See src/lib/citation-url.ts citationHost.';
comment on column public.citations.position is
  '0-based index of this citation within the answer''s citation array (order the engine returned them); null when a source cannot supply order.';
