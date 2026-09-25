-- ============================================================
-- 3D-shop pricing & product database
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query
-- ============================================================

create extension if not exists "pgcrypto";

-- Machines (3D-printers, UV-printers, lasers, sublimatiepers, ...)
create table if not exists machines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'overig', -- '3d_printer' | 'uv_printer' | 'laser' | 'sublimation_printer' | 'heat_press' | 'overig'
  purchase_price numeric not null default 0,
  expected_lifetime_hours numeric not null default 4000,
  avg_power_w numeric not null default 0,
  electricity_price numeric not null default 0.30, -- €/kWh
  created_at timestamptz not null default now()
);

-- Materialen (filament, inkt, papier, blanco-objecten, laser-materiaal, ...)
create table if not exists materials (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'overig',
  unit text not null default 'stuk', -- 'g' | 'kg' | 'ml' | 'vel' | 'stuk' | 'm2'
  price_per_unit numeric not null default 0,
  ink_coverage_ml_per_m2 numeric, -- enkel voor inkt (unit "ml"): geschat verbruik bij volledige dekking van 1 m²
  created_at timestamptz not null default now()
);

-- Producten (komen overeen met WooCommerce 'variable' hoofdproducten)
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  process_type text not null default '3d_print', -- '3d_print' | 'uv_print' | 'laser_engraving' | 'laser_cutting' | 'sublimation'
  published boolean not null default true,
  attribute_names text[] not null default '{}', -- bv. ARRAY['Grootte','Kleur'] -- volgorde bepaalt Attribute 1/2/3 in de export
  default_attribute_values jsonb not null default '{}'::jsonb, -- bv. {"Grootte":"M"} -- vooraf geselecteerde waarde per attribuut op de productpagina (WooCommerce "Default Form Values")
  personalization jsonb not null default '{"plugin":"none","zones":[]}'::jsonb, -- meerprijs voor de 3DP Gravure/UV- of T-shirt-personalisatieplugin (post-meta _tdp_fee / _tdpt_fee / _tdpt_back_fee), los van de variantprijs
  last_exported_published boolean, -- publicatiestatus zoals de vorige sync die zelf pushte; wijkt WooCommerce hiervan af, dan is dat een externe wijziging (zie migration_010)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Variaties (komen overeen met WooCommerce 'variation' rijen)
-- cost_inputs bevat ALLE prijsberekeningsgegevens (materialen, machinetijd, arbeid, marge)
-- Dit veld wordt NOOIT geëxporteerd naar WooCommerce -- puur intern, later terug op te zoeken/aan te passen.
create table if not exists product_variations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  sku text not null unique,
  attribute_values jsonb not null default '{}'::jsonb, -- bv. {"Grootte":"M","Kleur":"Rood"}
  cost_inputs jsonb not null default '{
    "materials": [],
    "machine_time": [],
    "labor_minutes": 0,
    "labor_rate": 0,
    "other_costs": 0,
    "margin": 0.45
  }'::jsonb,
  cost_price numeric,          -- laatst berekende kostprijs (cache, voor snelle lijstweergave)
  sale_price numeric,          -- laatst berekende verkoopprijs excl. btw
  suggested_price numeric,     -- afgeronde ,95-verkoopprijs incl. btw -- DIT wordt geëxporteerd naar WooCommerce
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_variations_product on product_variations(product_id);

-- ============================================================
-- Row Level Security -- alleen ingelogde gebruikers mogen lezen/schrijven
-- ============================================================
alter table machines enable row level security;
alter table materials enable row level security;
alter table products enable row level security;
alter table product_variations enable row level security;

create policy "authenticated full access" on machines
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on materials
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on products
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on product_variations
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================
-- Voorbeelddata (optioneel -- verwijder deze sectie als je liever leeg begint)
-- ============================================================
insert into machines (name, category, purchase_price, expected_lifetime_hours, avg_power_w, electricity_price) values
  ('Bambu Lab H2D', '3d_printer', 1899, 5000, 180, 0.30),
  ('Bambu Lab X1 Carbon', '3d_printer', 1500, 5000, 120, 0.30),
  ('Snapmaker U1', '3d_printer', 999, 5000, 150, 0.30)
on conflict do nothing;

insert into materials (name, category, unit, price_per_unit) values
  ('PLA', 'filament', 'kg', 22),
  ('PETG', 'filament', 'kg', 28)
on conflict do nothing;
