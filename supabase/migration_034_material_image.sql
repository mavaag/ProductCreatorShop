-- ============================================================
-- Migratie: afbeelding per materiaal (Materialen-pagina)
--   materials.image_url = publieke URL van een foto in de opslag (product-images/materials/...), automatisch
--   opgehaald van de leverancierslink of zelf opgeladen. Leeg = het categorie-icoon zoals vroeger.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query -- VOOR je de bijhorende PR merget.
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table materials add column if not exists image_url text;
