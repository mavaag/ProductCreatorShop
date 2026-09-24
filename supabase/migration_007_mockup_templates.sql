-- ============================================================
-- Migratie: mockup-generator
--   * herbruikbare "templates": een kamerfoto + de 4 hoekpunten van het kader
--   * storage bucket voor de kamerfoto's van die templates
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

create table if not exists mockup_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  room_image_url text not null,
  -- 4 punten, genormaliseerd (0-1) t.o.v. de afbeeldingsafmetingen, volgorde:
  -- linksboven, rechtsboven, rechtsonder, linksonder (= de binnenkant van het kader)
  corners jsonb not null,
  created_at timestamptz not null default now()
);

alter table mockup_templates enable row level security;

create policy "authenticated full access" on mockup_templates
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Storage bucket voor de kamerfoto's (publiek leesbaar, zodat de <img>/canvas ze kan laden).
insert into storage.buckets (id, name, public)
values ('mockup-templates', 'mockup-templates', true)
on conflict (id) do nothing;

create policy "mockup templates publiek leesbaar" on storage.objects
  for select using (bucket_id = 'mockup-templates');
create policy "mockup templates uploaden" on storage.objects
  for insert to authenticated with check (bucket_id = 'mockup-templates');
create policy "mockup templates bijwerken" on storage.objects
  for update to authenticated using (bucket_id = 'mockup-templates');
create policy "mockup templates verwijderen" on storage.objects
  for delete to authenticated using (bucket_id = 'mockup-templates');
