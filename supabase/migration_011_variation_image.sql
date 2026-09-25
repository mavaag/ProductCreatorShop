-- ============================================================
-- Migratie: afbeelding per variant
--   WooCommerce laat toe om per variatie (bv. per kleur) een eigen afbeelding in te stellen, los van
--   de productafbeeldingen. Voegt dat lokaal toe zodat je 'm hier kan instellen en in beide richtingen
--   kan synchroniseren met WooCommerce.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table product_variations
  add column if not exists image_url text;

comment on column product_variations.image_url is 'Eigen afbeelding voor deze variant (URL), los van de productafbeeldingen -- WooCommerce ondersteunt hier maar 1 afbeelding per variatie, dus geen komma-lijst zoals bij products.image_url.';
