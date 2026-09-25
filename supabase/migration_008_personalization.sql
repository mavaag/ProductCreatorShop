-- ============================================================
-- Migratie: personalisatie-meerprijs (3DP Gravure Preview- en 3DP T-shirt Preview-plugin)
--   Voegt een meerprijs-berekening per PRODUCT toe (los van de variantprijs), voor producten
--   waarbij de klant zelf een tekst/logo/tekening kan opladen via een van deze WordPress-plugins.
--   Wordt bij de WooCommerce-sync als post-meta geëxporteerd (_tdp_fee / _tdpt_fee / _tdpt_back_fee).
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table products
  add column if not exists personalization jsonb not null default '{"plugin":"none","zones":[]}'::jsonb;

comment on column products.personalization is 'Meerprijs-berekening voor de 3DP Gravure/UV- of T-shirt-personalisatieplugin, bv. {"plugin":"tshirt","zones":[{"key":"front","cost_inputs":{...},"fee":4.95}]} -- geëxporteerd als post-meta _tdp_fee / _tdpt_fee / _tdpt_back_fee, los van de normale variantprijs.';
