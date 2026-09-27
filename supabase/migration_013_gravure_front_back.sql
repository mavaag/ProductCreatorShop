-- ============================================================
-- Migratie: gravure/UV-print personalisatie krijgt een aparte voor- en achterkant-zone
--   De 3DP Gravure Preview-plugin ondersteunt intussen een aparte meerprijs voor de achterkant
--   (post-meta _tdp_back_fee, naast _tdp_fee voor de voorkant), net zoals de T-shirt-plugin dat al
--   deed. Deze migratie hernoemt de bestaande "single"-zone naar "front" zodat de al ingestelde
--   meerprijs behouden blijft; de nieuwe "back"-zone wordt bij het openen van het product in de
--   ProductCreator automatisch aangevuld (leeg, geen meerprijs) -- zie reconcilePersonalizationZones
--   in app/products/[id]/page.tsx.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

update products
set personalization = jsonb_set(
  personalization,
  '{zones}',
  (
    select jsonb_agg(
      case when elem->>'key' = 'single' then jsonb_set(elem, '{key}', '"front"')
           else elem
      end
    )
    from jsonb_array_elements(personalization->'zones') as elem
  )
)
where personalization->>'plugin' = 'gravure_uv'
  and personalization->'zones' @> '[{"key":"single"}]'::jsonb;
