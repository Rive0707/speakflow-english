create table if not exists public.phrases (
  id text primary key,
  en text not null,
  ja text default '',
  context text default '',
  vid text default '',
  t double precision default 0,
  title text default '',
  created timestamptz default now(),
  source text default 'netflix'
);

-- The service role key is used only by the SpeakFlow backend.
-- Do not expose it in the PWA or Chrome extension.
