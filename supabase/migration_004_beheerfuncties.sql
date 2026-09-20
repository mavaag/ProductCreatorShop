-- ============================================================
-- Migratie: beheerfuncties
--   * extra WooCommerce-velden per product (beschrijving, categorieën, afbeelding, gewicht, verzendklasse)
--   * export-tracking (enkel gewijzigde producten exporteren)
--   * prijsgeschiedenis per variant
--   * voorraad + minimumvoorraad per materiaal
--   * instellingen (o.a. minimale marge)
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table products add column if not exists description text not null default '';
alter table products add column if not exists categories text not null default '';   -- WooCommerce-notatie, bv. "Woondecoratie > Vazen, Cadeaus"
alter table products add column if not exists image_url text not null default '';    -- meerdere URL's mogelijk, gescheiden door komma
alter table products add column if not exists weight_kg numeric;
alter table products add column if not exists shipping_class text not null default '';
alter table products add column if not exists last_exported_at timestamptz;

-- De prijs zoals die de laatste keer geëxporteerd werd, om wijzigingen te kunnen detecteren.
alter table product_variations add column if not exists exported_price numeric;

alter table materials add column if not exists stock_quantity numeric;  -- in de eenheid van het materiaal; leeg = niet bijgehouden
alter table materials add column if not exists min_stock numeric;       -- onder deze waarde verschijnt een waarschuwing

create table if not exists price_history (
  id uuid primary key default gen_random_uuid(),
  variation_id uuid not null references product_variations(id) on delete cascade,
  cost_price numeric,
  sale_price numeric,
  suggested_price numeric,
  margin numeric,
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_price_history_variation on price_history(variation_id, created_at desc);

create table if not exists settings (
  key text primary key,
  value jsonb not null
);
insert into settings (key, value) values ('min_margin', '0.30'::jsonb) on conflict do nothing;

alter table price_history enable row level security;
alter table settings enable row level security;

create policy "authenticated full access" on price_history
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on settings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Startpunt voor de prijsgeschiedenis van bestaande varianten.
insert into price_history (variation_id, cost_price, sale_price, suggested_price, margin, reason)
select id, cost_price, sale_price, suggested_price, (cost_inputs->>'margin')::numeric, 'Startpunt'
from product_variations
where suggested_price is not null
  and not exists (select 1 from price_history h where h.variation_id = product_variations.id);
