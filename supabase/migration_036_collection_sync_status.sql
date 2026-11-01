-- ============================================================
-- Migratie: sync-status van collecties
--   - collections.synced_at: wanneer de collectie het laatst naar de shop ging (gewijzigd = updated_at > synced_at).
--   - collections.background / background_url / background_color: achtergrond van de collectiepagina.
--   - product_collections.removed_at: product uit de collectie gehaald maar nog niet gesynct. De sync haalt de
--     categorie dan in de shop weg en verwijdert de rij daarna; zo weet "Naar de shop" welke producten mee moeten.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query -- VOOR je de bijhorende PR merget.
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table collections add column if not exists synced_at timestamptz;
alter table product_collections add column if not exists removed_at timestamptz;

-- Achtergrond van de collectiepagina: een thema ('kerst', 'halloween', ...), 'custom' (eigen afbeelding) of 'none'.
alter table collections add column if not exists background text not null default 'none';
alter table collections add column if not exists background_url text;     -- eigen afbeelding (background = 'custom')
alter table collections add column if not exists background_color text;   -- '#rrggbb', leeg = kleur van het thema
update collections set background = lower(name)
  where background = 'none' and lower(name) in ('kerst', 'halloween', 'valentijn', 'pasen', 'sinterklaas', 'moederdag', 'vaderdag');

-- Collecties die al naar de shop gingen (hebben een categorie) gelden als gesynct.
update collections set synced_at = updated_at where woo_category_id is not null and synced_at is null;
