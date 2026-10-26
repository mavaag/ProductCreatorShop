-- ============================================================
-- Migratie: merkfiguren terugvinden in de Catalogus
--   is_trademark = het productdocument zegt dat het model een merk/personage van iemand anders gebruikt
--   (doc.license.trademark). Zo kan je later snel alle merkproducten vinden en eventueel verwijderen.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query -- VOOR je de bijhorende PR merget.
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table maker_models add column if not exists is_trademark boolean
  generated always as (coalesce((doc -> 'license' ->> 'trademark')::boolean, false)) stored;
