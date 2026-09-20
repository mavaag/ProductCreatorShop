-- ============================================================
-- Migratie: meerdere attributen per product (bv. Grootte + Kleur samen)
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query
-- Bewaart je bestaande producten/varianten -- geen dataverlies.
-- ============================================================

-- 1. Nieuwe kolommen toevoegen
alter table products add column if not exists attribute_names text[] not null default '{}';
alter table product_variations add column if not exists attribute_values jsonb not null default '{}'::jsonb;

-- 2. Bestaande data overzetten naar de nieuwe structuur
update products
set attribute_names = array[attribute_name]
where attribute_name is not null and attribute_names = '{}';

update product_variations pv
set attribute_values = jsonb_build_object(p.attribute_name, pv.attribute_value)
from products p
where pv.product_id = p.id
  and pv.attribute_values = '{}'::jsonb
  and p.attribute_name is not null;

-- 3. Oude (enkelvoudige) kolommen verwijderen
alter table products drop column if exists attribute_name;
alter table product_variations drop column if exists attribute_value;
