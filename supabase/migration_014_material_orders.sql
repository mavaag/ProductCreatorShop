-- ============================================================
-- Migratie: bestellingen/aankopen van materiaal bijhouden
--   Een materiaal (bv. inkt, sublimatiepapier, shrink foil) wordt vaak in een verpakking gekocht
--   (doos met cartridges, pak van 100 vel, zak van 50 stuks). "packages" x "units_per_package" (in
--   de eenheid van het materiaal zelf) geeft de totale hoeveelheid; die telt pas mee bij de voorraad
--   van het materiaal zodra de bestelling als ontvangen gemarkeerd is (received_at gezet) -- zie
--   lib/materialOrders.ts.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query
-- ============================================================

create table if not exists material_orders (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials(id) on delete cascade,
  packages numeric not null default 1,
  units_per_package numeric not null,
  quantity numeric not null,
  total_price numeric not null default 0,
  supplier_name text,
  ordered_at date not null default current_date,
  received_at date,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_material_orders_material on material_orders(material_id);

alter table material_orders enable row level security;
create policy "authenticated full access" on material_orders
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

comment on table material_orders is 'Bestelhistoriek per materiaal (hoeveelheid, prijs, leverancier, besteld/ontvangen). Bij ontvangst wordt materials.stock_quantity opgehoogd met quantity -- zie lib/materialOrders.ts.';
