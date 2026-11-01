-- ============================================================
-- Migratie: gravure-instellingen per variant (3DP Gravure Preview 1.9.0)
--   Bv. "Custom onderlegger" met varianten Leisteen rond / Leisteen vierkant: elke variant zijn eigen zone,
--   vorm en gravurekleur; de foto van de variant is de preview-afbeelding. Leeg (null) = zoals het product.
--   Wordt bij de sync als variant-meta _tdp_image, _tdp_x/_y/_w/_h, _tdp_shape, _tdp_color, _tdp_max_chars naar
--   WooCommerce gestuurd.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query -- VOOR je de bijhorende PR merget.
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table product_variations add column if not exists gravure jsonb;
