-- Voeg standaardwaarden per attribuut toe aan producten (WooCommerce "Default Form Values" --
-- de waarde die al geselecteerd staat wanneer een klant de productpagina opent, voor die klant
-- effectief een variant kiest).
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query

alter table products
  add column if not exists default_attribute_values jsonb not null default '{}'::jsonb;

comment on column products.default_attribute_values is 'Vooraf geselecteerde waarde per attribuut op de productpagina, bv. {"Grootte":"M"} -- komt overeen met WooCommerce "Default Form Values"';
