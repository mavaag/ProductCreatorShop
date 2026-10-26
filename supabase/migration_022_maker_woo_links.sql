-- ============================================================
-- Migratie: catalogusmodellen zelf koppelen aan een bestaand WooCommerce-product
--   maker_woo_links = jouw koppeling per model; gaat voor op wat de agent voorstelde (doc.woo_existing).
--   woo_product_id = null betekent: bewust NIET in de shop (de suggestie van de agent klopte niet).
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query -- VOOR je de bijhorende PR merget.
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

create table if not exists maker_woo_links (
  model_id text primary key references maker_models(id) on delete cascade,
  woo_product_id integer,
  woo_name text not null default '',
  woo_permalink text not null default '',
  created_at timestamptz not null default now()
);

alter table maker_woo_links enable row level security;
create policy "authenticated full access" on maker_woo_links
  for all to authenticated using (true) with check (true);
