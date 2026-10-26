-- ============================================================
-- Migratie: opdrachten voor de MakerProducts-agent (Docker-container op de NAS, zie maker-agent/)
--   maker_jobs  = één opdracht per klik op "Laat de agent dit verwerken" in de Catalogus: welke modellen,
--                 extra instructies, en de voortgang/resultaten die de agent terugschrijft.
--   maker_agent = één rij met de "hartslag" van de agent, zodat de Catalogus kan tonen of hij draait.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

create table if not exists maker_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  model_ids text[] not null,
  note text not null default '',            -- extra instructies van de gebruiker, bv. "ook een 6 mm-versie"
  progress text not null default '',        -- laatste voortgangsmelding van de agent
  results jsonb not null default '{}',      -- per model: {"status": "ok"|"failed"|"skipped", "note": "..."}
  log_tail text not null default '',        -- laatste regels van de agent (voor diagnose)
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists maker_jobs_status_idx on maker_jobs (status, created_at);

create table if not exists maker_agent (
  id integer primary key default 1 check (id = 1),
  seen_at timestamptz,
  status text not null default '',
  version text not null default ''
);

alter table maker_jobs enable row level security;
alter table maker_agent enable row level security;
create policy "authenticated full access" on maker_jobs
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on maker_agent
  for all to authenticated using (true) with check (true);
