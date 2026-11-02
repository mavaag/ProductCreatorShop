-- ============================================================
-- Migratie 039: afgewerkte producten op voorraad ("klaar op voorraad")
--   product_variations.ready_stock: aantal stuks dat al gemaakt is (bv. op voorhand geprinte wall art).
--   "+ gemaakt" in de beheertool verhoogt het en trekt meteen de materialen af (ready_stock_moves).
--   Bij een bestelling (tools/maker/orders_sync.py) komt een regel eerst uit deze voorraad: dan gaan er
--   geen materialen meer af. order_line_stock legt per bestelregel vast hoeveel uit voorraad kwam
--   (en dat de regel verwerkt is); bij annuleren/terugbetalen gaat dat terug naar ready_stock.
-- Voer dit uit in Supabase Studio: SQL Editor > New query
-- ============================================================

alter table product_variations add column if not exists ready_stock integer not null default 0;

create table if not exists order_line_stock (
  wc_order_id bigint not null,
  wc_line_id bigint not null,
  variation_id uuid references product_variations(id) on delete set null,
  from_stock integer not null default 0,     -- stuks uit "klaar op voorraad"; de rest wordt gemaakt
  created_at timestamptz not null default now(),
  primary key (wc_order_id, wc_line_id)
);

create table if not exists ready_stock_moves (
  id uuid primary key default gen_random_uuid(),
  variation_id uuid not null references product_variations(id) on delete cascade,
  delta integer not null,                    -- + gemaakt / - correctie
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ready_stock_moves_variation on ready_stock_moves(variation_id);

alter table order_line_stock enable row level security;
alter table ready_stock_moves enable row level security;
drop policy if exists "authenticated full access" on order_line_stock;
create policy "authenticated full access" on order_line_stock for all to authenticated using (true) with check (true);
drop policy if exists "authenticated full access" on ready_stock_moves;
create policy "authenticated full access" on ready_stock_moves for all to authenticated using (true) with check (true);
