-- Voeg leverancier informatie toe aan materialen
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query

alter table materials
  add column if not exists supplier_name text,
  add column if not exists supplier_url text;

comment on column materials.supplier_name is 'Naam van de shop/leverancier waar dit materiaal gekocht werd';
comment on column materials.supplier_url is 'Link naar de productpagina of webshop waar dit materiaal gekocht kan worden';
