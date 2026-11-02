-- Migratie 040: verzendgewicht per variant (bv. maat S door de brievenbus, M en L als pakje).
-- Leeg (null) = het gewicht van het product. De sync zet het op de variant in WooCommerce; daar betekent leeg
-- ook "zoals het product", dus bestaande varianten veranderen niet.

alter table product_variations add column if not exists weight_kg numeric;

comment on column product_variations.weight_kg is 'Verzendgewicht (kg, incl. verpakking) van deze variant; null = gewicht van het product';
