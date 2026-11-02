-- ============================================================
-- Migratie 038: materiaalverbruik door bestellingen
--   Bij elke betaalde/open bestelling (in verwerking, on hold, afgerond) trekt de maker-agent
--   (tools/maker/orders_sync.py, elke 10 minuten) de materialen van de varianten (kostenopbouw x aantal)
--   af van materials.stock_quantity. Per bestelregel en materiaal wordt dat één keer vastgelegd in
--   material_consumption, zodat niets dubbel geteld wordt. Wordt een bestelling geannuleerd, terugbetaald
--   of mislukt, dan komt het verbruik terug bij de voorraad en verdwijnen de rijen.
--   Enkel bestellingen vanaf het moment van deze migratie (settings.stock_tracking_since) tellen mee.
-- Voer dit uit in Supabase Studio: SQL Editor > New query
-- ============================================================

create table if not exists material_consumption (
  id uuid primary key default gen_random_uuid(),
  wc_order_id bigint not null,
  wc_line_id bigint not null,
  material_id uuid not null references materials(id) on delete cascade,
  quantity numeric not null,          -- in de eenheid van het materiaal
  created_at timestamptz not null default now(),
  unique (wc_order_id, wc_line_id, material_id)
);
create index if not exists idx_material_consumption_material on material_consumption(material_id);

alter table material_consumption enable row level security;
drop policy if exists "authenticated full access" on material_consumption;
create policy "authenticated full access" on material_consumption
  for all to authenticated using (true) with check (true);

insert into settings (key, value) values ('stock_tracking_since', to_jsonb(now()))
  on conflict (key) do nothing;
