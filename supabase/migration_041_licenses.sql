-- ============================================================
-- Migratie: Licenties (betaalde licenties van artiesten, bv. PinkyWings op MakerWorld)
--   licenses          = één rij per licentie: artiest, platform, profiel, betaaldatum, geldig tot, prijs.
--                       reminder_sent_for = de vervaldatum waarvoor de herinneringsmail (30 dagen op voorhand) al
--                       verstuurd is, zodat er per periode maar één mail vertrekt (tools/licenses/license_reminders.py).
--   license_models    = de modellen van die artiest zoals bij de laatste update gezien; jouw keuze (pick) en, zodra
--                       het in de bibliotheek staat, het catalogusmodel (maker_model_id).
--                       first_seen_at = wanneer het model voor het eerst opdook ("Nieuw" na een update);
--                       removed_at    = niet meer gezien bij de laatste update (offline gehaald door de artiest).
--   license_refreshes = logboek van de updates (hoeveel nieuw / verdwenen).
--   maker_jobs.kind 'license' = gedownloade bestanden uit _Inbox/_Licenties/<artiest> in de bibliotheek zetten.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query -- VOOR je de bijhorende PR merget.
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

create table if not exists licenses (
  id uuid primary key default gen_random_uuid(),
  artist text not null,
  platform text not null default 'makerworld' check (platform in ('makerworld', 'printables', 'thangs', 'patreon', 'myminifactory', 'cults3d', 'other')),
  profile_url text not null default '',
  platform_user_id text,                      -- MakerWorld: numerieke uid (nodig voor het ophalen van de modellenlijst)
  handle text,                                -- MakerWorld: bv. 'pinkywings' (zonder @)
  purchased_on date not null,
  valid_until date,                           -- leeg = loopt niet af
  price numeric(10, 2),
  currency text not null default 'EUR',
  terms text not null default '',             -- wat de licentie toelaat (bv. "verkoop van prints, geen bestanden")
  notes text not null default '',
  folder text not null default '',            -- map in de bibliotheek, bv. '3D-Print/PinkyWings'
  reminder_sent_for date,
  last_refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists license_models (
  license_id uuid not null references licenses (id) on delete cascade,
  source_id text not null,                    -- id op het platform (MakerWorld design-id)
  title text not null,
  url text not null default '',
  cover_url text,
  downloads integer not null default 0,
  likes integer not null default 0,
  prints integer not null default 0,
  published_at date,
  print_minutes integer,
  weight_g integer,
  profiles integer,
  tags text[] not null default '{}',
  trademark text,                             -- merk/personage van iemand anders (bv. "Godzilla (Toho)"), anders leeg
  pick text check (pick in ('yes', 'maybe', 'no')),
  picked_at timestamptz,
  maker_model_id text references maker_models (id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (license_id, source_id)
);
create index if not exists license_models_pick_idx on license_models (license_id, pick);

create table if not exists license_refreshes (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references licenses (id) on delete cascade,
  created_at timestamptz not null default now(),
  source text not null default 'browser',     -- 'browser' (knop op MakerWorld), 'paste' (geplakt), 'claude'
  total integer not null default 0,
  new_count integer not null default 0,
  removed_count integer not null default 0
);

alter table licenses enable row level security;
alter table license_models enable row level security;
alter table license_refreshes enable row level security;
create policy "authenticated full access" on licenses for all to authenticated using (true) with check (true);
create policy "authenticated full access" on license_models for all to authenticated using (true) with check (true);
create policy "authenticated full access" on license_refreshes for all to authenticated using (true) with check (true);

alter table maker_jobs drop constraint if exists maker_jobs_kind_check;
alter table maker_jobs add constraint maker_jobs_kind_check check (kind in ('models', 'inbox', 'split', 'set', 'license'));
