-- ============================================================
-- Migratie: opdrachtsoort 'split' voor de MakerProducts-agent ("Bundel opsplitsen" in de Catalogus)
--   Een catalogusmodel dat eigenlijk een map met veel losse modellen is, laat de agent opsplitsen in submappen
--   (één per model). De bundel wordt daarna een verzamelmap in _catalog/sources.json en verdwijnt als kaartje.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query -- VOOR je de bijhorende PR merget.
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table maker_jobs drop constraint if exists maker_jobs_kind_check;
alter table maker_jobs add constraint maker_jobs_kind_check check (kind in ('models', 'inbox', 'split'));
