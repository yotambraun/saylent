-- Share-the-dossier: a 128-bit token gates PUBLIC read-only rendering of a
-- finished audit.
-- RLS untouched — the public page reads server-side via service role only;
-- anon/API access to runs remains owner-scoped.
alter table public.runs
  add column if not exists share_token uuid unique;
