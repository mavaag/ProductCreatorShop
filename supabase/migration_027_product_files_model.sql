-- ============================================================
-- Migratie: catalogusmodel bij de productiebestanden van een product
--   product_files.model_id = het catalogusmodel (maker_models.id) waar de map vandaan komt (source 'catalog').
--   tools/maker/shop_links.py kopieert dat model naar _Shop/<techniek>/<categorie>/<naam> en schrijft de rij.
--   De productenlijst toont daarmee het label "Catalogus" (klik = model openen in de Catalogus).
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query -- VOOR je de bijhorende PR merget.
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table product_files add column if not exists model_id text;
