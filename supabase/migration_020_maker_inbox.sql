-- ============================================================
-- Migratie: Inbox voor de MakerProducts-agent
--   Nieuwe modellen zet je in \\NASMAT\MakerProducts\_Inbox (bestanden, mappen, zip/rar). De agent toont wat er
--   klaarstaat in de Catalogus (maker_agent.inbox); met "Inbox verwerken" maak je een opdracht van soort 'inbox':
--   de agent sorteert alles in de bibliotheek en verplaatst verwerkte items naar _Inbox/_verwerkt, dat na een aantal
--   dagen automatisch leeggemaakt wordt.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table maker_jobs add column if not exists kind text not null default 'models';
alter table maker_jobs drop constraint if exists maker_jobs_kind_check;
alter table maker_jobs add constraint maker_jobs_kind_check check (kind in ('models', 'inbox'));
alter table maker_jobs add column if not exists items text[] not null default '{}';           -- inbox: namen in _Inbox
alter table maker_jobs add column if not exists then_process boolean not null default false;  -- inbox: daarna platen + documenten

alter table maker_agent add column if not exists inbox jsonb not null default '[]';    -- [{name, kind, size, files, ready}]
alter table maker_agent add column if not exists inbox_info text not null default '';  -- bv. "_verwerkt: 3 items, opgeruimd na 14 dagen"
