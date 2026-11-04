-- Migratie 042: opslag voor modellen die de extensie MakerWorld-hulp downloadt (knop "Downloaden en in de Catalogus
-- zetten" bij Licenties). De beheertool zet de bestanden hier in stukken van 8 MB; de maker-agent haalt ze op,
-- zet ze in _Inbox/_Licenties/<artiest> op de NAS en verwijdert ze dan uit deze bucket. Niet publiek.
insert into storage.buckets (id, name, public)
values ('license-inbox', 'license-inbox', false)
on conflict (id) do nothing;

create policy "license inbox lezen" on storage.objects
  for select to authenticated using (bucket_id = 'license-inbox');
create policy "license inbox uploaden" on storage.objects
  for insert to authenticated with check (bucket_id = 'license-inbox');
create policy "license inbox bijwerken" on storage.objects
  for update to authenticated using (bucket_id = 'license-inbox');
create policy "license inbox verwijderen" on storage.objects
  for delete to authenticated using (bucket_id = 'license-inbox');
