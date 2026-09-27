-- ============================================================
-- Migratie: WooCommerce-bestellingen synchroniseren (lokale kopie voor rapportage/grafieken)
--   Haalt bestellingen (en hun regels) op uit WooCommerce en bewaart ze lokaal, zodat de
--   Bestellingen-pagina omzet/aantal orders per maand en meest bestelde producten kan tonen zonder
--   telkens de volledige historiek bij WooCommerce op te vragen. De sync is incrementeel: de datum
--   van de laatst geziene wijziging wordt bijgehouden in de bestaande "settings"-tabel (key
--   "last_order_sync_at") -- zie app/api/woocommerce/orders-sync/route.ts.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query
-- ============================================================

create table if not exists wc_orders (
  id uuid primary key default gen_random_uuid(),
  wc_order_id bigint not null unique, -- WooCommerce's eigen order-id
  order_number text not null,         -- weergavenummer (meestal gelijk aan wc_order_id, maar niet gegarandeerd)
  status text not null,               -- 'pending' | 'processing' | 'on-hold' | 'completed' | 'cancelled' | 'refunded' | 'failed' | ...
  currency text not null default 'EUR',
  total numeric not null default 0,
  date_created timestamptz not null,
  date_modified timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_wc_orders_date_created on wc_orders(date_created);
create index if not exists idx_wc_orders_status on wc_orders(status);

create table if not exists wc_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references wc_orders(id) on delete cascade,
  wc_product_id bigint,
  wc_variation_id bigint,
  sku text,
  name text not null,
  quantity numeric not null default 0,
  total numeric not null default 0 -- lijnomzet excl. btw, zoals WooCommerce ze teruggeeft
);
create index if not exists idx_wc_order_items_order on wc_order_items(order_id);
create index if not exists idx_wc_order_items_sku on wc_order_items(sku);

alter table wc_orders enable row level security;
alter table wc_order_items enable row level security;
create policy "authenticated full access" on wc_orders
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on wc_order_items
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

comment on table wc_orders is 'Lokale kopie van WooCommerce-bestellingen (voor de Bestellingen-rapportagepagina). Bron van waarheid blijft WooCommerce zelf -- deze tabel wordt bij elke sync overschreven/aangevuld.';
comment on table wc_order_items is 'Bestelregels per wc_orders-rij; wordt bij elke (her)sync van die bestelling volledig vervangen.';
