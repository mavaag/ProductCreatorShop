-- ============================================================
-- Migratie: Catalogus (MakerProducts-bibliotheek op de NAS)
--   maker_models  = één rij per model uit _catalog/catalog.json (laser + 3D-print), met thumbnail-URL
--                   en -- zodra er een is -- het productdocument (beschrijving, varianten, foto's).
--                   Wordt gevuld door tools/maker/sync_catalog.py en tools/maker/publish_docs.py.
--   maker_picks   = jouw selectie in de Catalogus-pagina: welke modellen je wil verkopen, en of er
--                   al een product van gemaakt is (product_id).
--   products.short_description = korte beschrijving (WooCommerce "short description"); leeg = de sync
--                   laat de korte beschrijving in WooCommerce ongemoeid.
--   storage bucket "maker-thumbs" = publieke thumbnails van de catalogus.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

create table if not exists maker_models (
  id text primary key,                       -- catalog-id (12 hex), stabiel per modelmap
  title text not null,
  kind text not null,                        -- 'Lasercut' | '3D-Print'
  collection text not null default '',
  category text not null default '',
  path text not null,                        -- pad binnen MakerProducts
  formats jsonb not null default '{}',
  thicknesses jsonb not null default '[]',
  laser_ready jsonb not null default '[]',   -- namen van de LaserReady-mappen (snijklare platen)
  files integer not null default 0,
  thumb_url text,
  doc jsonb,                                 -- productdocument (schema 1), null = nog geen document
  has_doc boolean generated always as (doc is not null) stored,
  woo_product_id integer generated always as (((doc -> 'woo_existing') ->> 'id')::integer) stored,
  doc_updated_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists maker_models_kind_idx on maker_models (kind, collection, category);

create table if not exists maker_picks (
  model_id text primary key references maker_models (id) on delete cascade,
  product_id uuid references products (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table maker_models enable row level security;
alter table maker_picks enable row level security;
create policy "authenticated full access" on maker_models
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on maker_picks
  for all to authenticated using (true) with check (true);

alter table products add column if not exists short_description text not null default '';

insert into storage.buckets (id, name, public)
values ('maker-thumbs', 'maker-thumbs', true)
on conflict (id) do nothing;

create policy "maker thumbs publiek leesbaar" on storage.objects
  for select using (bucket_id = 'maker-thumbs');
