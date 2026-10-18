-- ============================================================
-- Migratie: mockup-templates per techniek
--   De mockup-generator heeft tabbladen per techniek (UV-print, lasergravure). Elke template hoort bij
--   één techniek: bij UV-print is het meestal een kamerfoto met een kader, bij lasergravure een foto
--   van het product met de gravurezone. Bestaande templates worden UV-print.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table mockup_templates
  add column if not exists technique text not null default 'uv'
  check (technique in ('uv', 'engrave'));
