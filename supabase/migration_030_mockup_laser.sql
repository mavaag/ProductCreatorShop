-- ============================================================
-- Migratie: techniek "Lasersnijden" in de mockup-generator
--   Nieuw tabblad voor lasersnijproducten (bv. kamerfoto's voor wandklokken). De klok-templates
--   (clock = true, migratie 029) verhuizen naar dit tabblad.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query -- VOOR je de bijhorende PR merget.
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

-- de oude check (enkel 'uv' en 'engrave') weghalen, ongeacht hoe Postgres hem genoemd heeft
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'mockup_templates'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%technique%'
  loop
    execute format('alter table mockup_templates drop constraint %I', c.conname);
  end loop;
end $$;

alter table mockup_templates add constraint mockup_templates_technique_check check (technique in ('uv', 'engrave', 'laser'));

update mockup_templates set technique = 'laser' where clock;
