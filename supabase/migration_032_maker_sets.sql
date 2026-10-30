-- ============================================================
-- Migratie: sets van gravureontwerpen (bv. 4 onderleggers met elk een ander ontwerp)
--   Nieuwe soort opdracht 'set' (knop "Maak set" in de Catalogus): de agent maakt de map Engraving/Sets/<naam> met
--   set.json (welke ontwerpen, niets gekopieerd) en een voorbeeldfoto; de set wordt daarna een eigen catalogusmodel.
--   items[0] = de naam van de set, model_ids = de ontwerpen in volgorde.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query -- VOOR je de bijhorende PR merget.
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table maker_jobs drop constraint if exists maker_jobs_kind_check;
alter table maker_jobs add constraint maker_jobs_kind_check check (kind in ('models', 'inbox', 'split', 'set'));
