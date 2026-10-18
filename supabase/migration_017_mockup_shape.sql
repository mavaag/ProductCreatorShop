-- ============================================================
-- Migratie: vorm van de zone per mockup-template
--   Een template kan een rechthoekige/vierkante zone hebben (standaard) of een ronde, bv. een ronde
--   onderlegger of een rond kader. Bij een cirkel mogen de 4 punten op de rand van de cirkel staan of
--   op de hoeken van het vierkant errond. Geldt voor alle technieken (UV-print en lasergravure).
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table mockup_templates
  add column if not exists shape text not null default 'rect'
  check (shape in ('rect', 'ellipse'));
