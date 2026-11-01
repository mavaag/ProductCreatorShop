-- ============================================================
-- Migratie 037: bedragen per bestelling voor "betaald / kostprijs / winst" (Bestellingen > Productie)
--   - wc_orders.shipping_total / shipping_tax / total_tax / discount_total: zoals WooCommerce ze teruggeeft
--   - wc_order_items.total_tax: btw op de regel (wc_order_items.total = regel excl. btw)
--   Bestaande bestellingen krijgen hun bedragen bij de volgende volledige sync (orders_sync.py --full).
-- Voer dit uit in Supabase Studio: SQL Editor > New query
-- ============================================================

alter table wc_orders add column if not exists shipping_total numeric not null default 0;
alter table wc_orders add column if not exists shipping_tax numeric not null default 0;
alter table wc_orders add column if not exists total_tax numeric not null default 0;
alter table wc_orders add column if not exists discount_total numeric not null default 0;
alter table wc_order_items add column if not exists total_tax numeric not null default 0;
