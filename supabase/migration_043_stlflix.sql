-- Migratie 043: platform "stlflix" voor licenties (STLFlix lifetime Commercial License, 2026-11-06).
-- STLFlix is een abonnementsbibliotheek (platform.stlflix.com) i.p.v. één artiest: de modellenlijst komt via de
-- Chrome-extensie (versie 1.2.0), downloaden doe je zelf op STLFlix (elke download heeft een botcontrole) en de
-- gedownloade zips sleep je in de tool. Voer dit uit in Supabase: SQL Editor > New query. Geen dataverlies.
alter table licenses drop constraint if exists licenses_platform_check;
alter table licenses add constraint licenses_platform_check
  check (platform in ('makerworld', 'printables', 'thangs', 'patreon', 'myminifactory', 'cults3d', 'stlflix', 'other'));

-- de STLFlix-licentie die al als "other" werd aangemaakt, omzetten
update licenses set platform = 'stlflix', profile_url = 'https://platform.stlflix.com/explore'
where platform = 'other' and lower(artist) = 'stlflix';
