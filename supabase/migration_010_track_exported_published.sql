-- ============================================================
-- Migratie: publicatiestatus niet meer overschrijven bij een sync
--   Probleem: als je een product rechtstreeks in WooCommerce publiceert (of terug op concept zet)
--   zonder dat ook in deze app te doen, overschreef de volgende sync die wijziging weer -- de app
--   pushte gewoon zijn eigen (verouderde) "published"-waarde.
--   Oplossing: we onthouden welke status we de vorige keer zelf gepusht hebben
--   (last_exported_published). Wijkt WooCommerce daar bij de volgende sync van af, dan is dat een
--   externe wijziging -- die nemen we dan over in de lokale database i.p.v. te overschrijven.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table products
  add column if not exists last_exported_published boolean;

comment on column products.last_exported_published is 'Publicatiestatus zoals de app die de vorige keer zelf naar WooCommerce pushte -- null = nog nooit gesynct. Wijkt de huidige status in WooCommerce hiervan af, dan is dat een handmatige wijziging in WooCommerce zelf, die de volgende sync overneemt i.p.v. overschrijft.';
