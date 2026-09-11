-- Persisting ok/ERROR per answer is required; the original answers schema had
-- no error column, which hid provider failures (e.g. Gemini free-tier 429s)
-- and broke the dossier's answers query.
alter table public.answers add column if not exists error text;
