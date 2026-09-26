-- ============================================================
-- Migratie: storage bucket voor lokaal opgeladen productafbeeldingen
--   Laat toe om bij de WooCommerce-gegevens van een product (of variant) een afbeelding
--   van je eigen pc te kiezen i.p.v. enkel een URL te plakken. Die afbeelding wordt hier
--   opgeslagen en de publieke URL komt in het bestaande image_url-veld terecht, dat bij
--   het synchroniseren met WooCommerce toch al als een gewone (externe) URL wordt behandeld.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "product images publiek leesbaar" on storage.objects
  for select using (bucket_id = 'product-images');
create policy "product images uploaden" on storage.objects
  for insert to authenticated with check (bucket_id = 'product-images');
create policy "product images bijwerken" on storage.objects
  for update to authenticated using (bucket_id = 'product-images');
create policy "product images verwijderen" on storage.objects
  for delete to authenticated using (bucket_id = 'product-images');
