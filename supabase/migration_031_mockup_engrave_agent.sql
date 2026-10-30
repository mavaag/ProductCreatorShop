-- ============================================================
-- Migratie: gravure-templates voor de agent
--   zones            = alle zones van een template met meerdere zones (bv. een set van 4 onderleggers):
--                      [{corners: [{x,y} x4], shape: 'rect'|'ellipse'}, ...]; leeg = één zone (corners + shape).
--                      corners/shape blijven altijd gelijk aan de eerste zone.
--   engrave_settings = gravurekleur, soort afbeelding en lettertype van deze template ({color, imageMode, font}),
--                      zodat de agent dezelfde gravure maakt als de Mockup-generator.
--   product_kind     = soort product op de foto, bv. "Snijplank" of "Onderlegger" (de agent kiest hierop).
--   agent            = de agent gebruikt deze template voor de productfoto's van nieuwe gravuremodellen.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query -- VOOR je de bijhorende PR merget.
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table mockup_templates add column if not exists zones jsonb;
alter table mockup_templates add column if not exists engrave_settings jsonb;
alter table mockup_templates add column if not exists product_kind text not null default '';
alter table mockup_templates add column if not exists agent boolean not null default false;
