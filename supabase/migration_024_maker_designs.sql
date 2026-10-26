-- ============================================================
-- Migratie: per catalogusmodel het geschatte aantal ontwerpen + de bundel waar het uit komt
--   designs = aantal verschillende ontwerpen (bestandsnamen zonder dikte/maat/volgnummer); "Bundel opsplitsen"
--             verschijnt enkel bij modellen met veel ontwerpen.
--   bundle  = naam van de bundel waaruit dit model kwam (leeg = geen); zo'n model is al opgesplitst.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query -- VOOR je de bijhorende PR merget.
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table maker_models add column if not exists designs integer not null default 0;
alter table maker_models add column if not exists bundle text not null default '';
