-- ============================================================
-- Migratie: sync-status van collecties
--   - collections.synced_at: wanneer de collectie het laatst naar de shop ging (gewijzigd = updated_at > synced_at).
--   - product_collections.removed_at: product uit de collectie gehaald maar nog niet gesynct. De sync haalt de
--     categorie dan in de shop weg en verwijdert de rij daarna; zo weet "Naar de shop" welke producten mee moeten.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query -- VOOR je de bijhorende PR merget.
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table collections add column if not exists synced_at timestamptz;
alter table product_collections add column if not exists removed_at timestamptz;

-- Collecties die al naar de shop gingen (hebben een categorie) gelden als gesynct.
update collections set synced_at = updated_at where woo_category_id is not null and synced_at is null;
