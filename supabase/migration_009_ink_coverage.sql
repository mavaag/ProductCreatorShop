-- ============================================================
-- Migratie: geschat inktverbruik per m² voor materialen
--   Laat je bij een inkt-materiaal (unit "ml") een gemiddeld verbruik bij volledige dekking van
--   1 m² opgeven, zodat de productpagina de benodigde hoeveelheid kan voorstellen voor een
--   personalisatiezone (gravure/UV of T-shirt), op basis van de printzone-afmetingen.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table materials
  add column if not exists ink_coverage_ml_per_m2 numeric;

comment on column materials.ink_coverage_ml_per_m2 is 'Enkel voor inkt (unit "ml"): geschat verbruik in ml bij volledige dekking van 1 m² -- gebruikt om de hoeveelheid in een personalisatiezone voor te stellen.';
