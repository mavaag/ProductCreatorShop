-- ============================================================
-- Migratie: techniek per catalogusmodel (resin / fdm / laser)
--   Komt uit _technique.txt in de modelmap (die de agent schrijft voor items uit _Inbox/Resin of _Inbox/FDM), of
--   wordt herkend uit de bestanden (voorgesupporte bestanden / resin-slicerprojecten -> resin). "" = nog niet bekend.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query -- VOOR je de bijhorende PR merget.
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table maker_models add column if not exists technique text not null default '';
