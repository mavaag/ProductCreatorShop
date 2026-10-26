-- ============================================================
-- Migratie: productie van bestellingen (tabblad Bestellingen > Productie)
--   - wc_orders / wc_order_items: klant, verzending, opmerking en per regel de gekozen opties (variant,
--     personalisatie) en het WooCommerce-regelnummer.
--   - wc_production: per bestelregel "gemaakt" afvinken. Apart van wc_order_items, omdat die regels bij elke sync
--     opnieuw geschreven worden.
--   - product_files: welke map(pen) op de NAS bij een product horen (relatief t.o.v. /volume1/MakerProducts).
--     source 'shop' = voorstel uit _Shop (kopie van de PRODUCTS-map van de pc), 'manual' = zelf gekozen.
--     confirmed = door jou bevestigd; onbevestigde rijen zijn voorstellen van match_shop_files.py.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query -- VOOR je de bijhorende PR merget.
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table wc_orders add column if not exists customer_name text not null default '';
alter table wc_orders add column if not exists shipping_method text not null default '';
alter table wc_orders add column if not exists customer_note text not null default '';
alter table wc_order_items add column if not exists wc_line_id bigint;
alter table wc_order_items add column if not exists meta jsonb not null default '[]';   -- [{key, value}]

create table if not exists wc_production (
  wc_order_id bigint not null,
  wc_line_id bigint not null,
  done_at timestamptz not null default now(),
  primary key (wc_order_id, wc_line_id)
);

create table if not exists product_files (
  product_id uuid not null references products(id) on delete cascade,
  path text not null,
  source text not null default 'shop',
  confirmed boolean not null default false,
  score numeric not null default 0,
  created_at timestamptz not null default now(),
  primary key (product_id, path)
);

alter table wc_production enable row level security;
alter table product_files enable row level security;
create policy "authenticated full access" on wc_production for all to authenticated using (true) with check (true);
create policy "authenticated full access" on product_files for all to authenticated using (true) with check (true);
