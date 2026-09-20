-- ============================================================
-- Migratie: afgeronde verkoopprijs incl. btw ("suggested_price"),
-- dit is voortaan het veld dat naar WooCommerce geëxporteerd wordt.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query
-- Bewaart je bestaande producten/varianten -- geen dataverlies.
-- ============================================================

alter table product_variations add column if not exists suggested_price numeric;

-- Vul suggested_price in voor bestaande varianten die al een sale_price hebben,
-- op basis van dezelfde regel als de app: verkoopprijs incl. btw afgerond naar
-- boven op een ,95-prijs (btw-percentage uit cost_inputs, of 21% als dat ontbreekt).
update product_variations
set suggested_price = (
  select case
    when (ceil(incl_vat) - 0.05) >= incl_vat then round((ceil(incl_vat) - 0.05)::numeric, 2)
    else round((ceil(incl_vat) - 0.05 + 1)::numeric, 2)
  end
  from (
    select sale_price * (1 + coalesce((cost_inputs->>'vat_rate')::numeric, 0.21)) as incl_vat
  ) s
)
where sale_price is not null and suggested_price is null;
