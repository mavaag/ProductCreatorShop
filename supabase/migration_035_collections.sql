-- ============================================================
-- Migratie: collecties (Kerst, Halloween, Moederdag, ...)
--   - collections: naam, tekst, bannerfoto, seizoen (MM-DD tot MM-DD) en wanneer ze op de homepage uitgelicht wordt.
--     In WooCommerce wordt elke collectie een categorie onder "Collecties" (woo_category_id), met eigen pagina.
--   - product_collections: welke producten in welke collectie zitten (een product kan in meerdere collecties).
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query -- VOOR je de bijhorende PR merget.
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

create table if not exists collections (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  banner_url text,
  season_start text,                       -- 'MM-DD', bv. '11-15'; leeg = geen seizoen
  season_end text,                         -- 'MM-DD', bv. '12-26' (mag over nieuwjaar lopen, bv. 12-01 tot 01-06)
  highlight text not null default 'season' check (highlight in ('season', 'always', 'never')),
  sort_order int not null default 0,
  woo_category_id bigint,                  -- categorie in WooCommerce (door de sync gezet)
  woo_image_src text,                      -- banner zoals laatst naar WooCommerce gestuurd (om niet telkens opnieuw op te laden)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_collections (
  product_id uuid not null references products(id) on delete cascade,
  collection_id uuid not null references collections(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, collection_id)
);
create index if not exists product_collections_collection_idx on product_collections (collection_id);

alter table collections enable row level security;
alter table product_collections enable row level security;
create policy "authenticated full access" on collections for all to authenticated using (true) with check (true);
create policy "authenticated full access" on product_collections for all to authenticated using (true) with check (true);
